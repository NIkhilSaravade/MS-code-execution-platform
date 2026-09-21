"""Phase 6b: LoRA fine-tune (4-bit QLoRA via bitsandbytes) of a small open
model on finetune/data/train.jsonl (see build_dataset.py) to specialize it
on this service's exact review task/schema. Real training on a real GPU
(confirmed: RTX 5060 Ti, 16GB VRAM, torch 2.11.0+cu128, CUDA 12.8,
compute capability (12, 0)) - not a CPU toy run.

Base model default: Qwen2.5-Coder-3B-Instruct (small variant first, to
validate the whole pipeline cheaply before considering the 7B variant -
see docs/ai-agent-build-log.md for whether that scale-up happened and why).

Standard causal-LM SFT: prompt tokens are masked out of the loss (label=-100),
only the completion (the JSON the model should learn to produce) is
trained on. Uses Qwen's own chat template so the model sees the same
turn-formatting it was originally instruction-tuned with.

Run: venv/Scripts/python.exe -m finetune.train_lora
"""

import json
import time
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
)

MODEL_ID = "Qwen/Qwen2.5-Coder-3B-Instruct"
# Pinned to a specific commit (confirmed via `HfApi().model_info(MODEL_ID).sha`
# at the time of this run) rather than "main" - a real supply-chain
# improvement bandit's B615 check flagged, not just a suppression: an
# unpinned from_pretrained() would silently pull whatever the repo owner
# pushes next time this script runs, potentially a different model.
MODEL_REVISION = "488639f1ff808d1d3d0ba301aef8c11461451ec5"
_THIS_DIR = Path(__file__).resolve().parent
_DATA_DIR = _THIS_DIR / "data"
_OUTPUT_DIR = _THIS_DIR / "checkpoints" / "qwen2.5-coder-3b-lora"
_TRAINING_LOG_PATH = _DATA_DIR / "training_log.json"

MAX_LENGTH = 2048
NUM_EPOCHS = 3
LEARNING_RATE = 2e-4
PER_DEVICE_BATCH_SIZE = 1
GRADIENT_ACCUMULATION_STEPS = 8


def _load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _build_example(tokenizer, prompt: str, completion: str) -> dict:
    prompt_messages = [{"role": "user", "content": prompt}]
    prompt_text = tokenizer.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True)
    full_text = prompt_text + completion + tokenizer.eos_token

    prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
    full_ids = tokenizer(full_text, add_special_tokens=False, truncation=True, max_length=MAX_LENGTH)["input_ids"]

    labels = list(full_ids)
    prompt_len = min(len(prompt_ids), len(full_ids))
    for i in range(prompt_len):
        labels[i] = -100

    return {"input_ids": full_ids, "attention_mask": [1] * len(full_ids), "labels": labels}


def _pad_collate(tokenizer):
    pad_id = tokenizer.pad_token_id

    def _collate(batch):
        max_len = max(len(ex["input_ids"]) for ex in batch)
        input_ids, attention_mask, labels = [], [], []
        for ex in batch:
            pad_len = max_len - len(ex["input_ids"])
            input_ids.append(ex["input_ids"] + [pad_id] * pad_len)
            attention_mask.append(ex["attention_mask"] + [0] * pad_len)
            labels.append(ex["labels"] + [-100] * pad_len)
        return {
            "input_ids": torch.tensor(input_ids),
            "attention_mask": torch.tensor(attention_mask),
            "labels": torch.tensor(labels),
        }

    return _collate


def main():
    if not torch.cuda.is_available():
        # Not an assert: asserts are stripped under `python -O`, and this
        # check must always run - this whole script is meaningless on CPU.
        raise RuntimeError(
            "This training run requires a real CUDA GPU - see docs/ai-agent-build-log.md's Phase 6 GPU verification."
        )
    print(f"GPU: {torch.cuda.get_device_name(0)}, capability {torch.cuda.get_device_capability(0)}")

    train_raw = _load_jsonl(_DATA_DIR / "train.jsonl")
    val_raw = _load_jsonl(_DATA_DIR / "val.jsonl")
    print(f"train examples: {len(train_raw)}, val examples: {len(val_raw)}")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, quantization_config=bnb_config, device_map={"": 0}, dtype=torch.bfloat16,
    )
    model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    train_dataset = Dataset.from_list([_build_example(tokenizer, ex["prompt"], ex["completion"]) for ex in train_raw])
    val_dataset = Dataset.from_list([_build_example(tokenizer, ex["prompt"], ex["completion"]) for ex in val_raw])

    training_args = TrainingArguments(
        output_dir=str(_OUTPUT_DIR),
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=PER_DEVICE_BATCH_SIZE,
        per_device_eval_batch_size=PER_DEVICE_BATCH_SIZE,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION_STEPS,
        learning_rate=LEARNING_RATE,
        bf16=True,
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="epoch",
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        data_collator=_pad_collate(tokenizer),
    )

    t0 = time.time()
    peak_mem_before = torch.cuda.max_memory_allocated() / 1e9
    train_result = trainer.train()
    elapsed = time.time() - t0
    peak_mem_after = torch.cuda.max_memory_allocated() / 1e9

    model.save_pretrained(str(_OUTPUT_DIR / "final_adapter"))
    tokenizer.save_pretrained(str(_OUTPUT_DIR / "final_adapter"))

    log_history = trainer.state.log_history
    per_epoch_eval_loss = [
        {"epoch": entry.get("epoch"), "eval_loss": entry.get("eval_loss")}
        for entry in log_history if "eval_loss" in entry
    ]

    summary = {
        "baseModel": MODEL_ID,
        "trainExamples": len(train_raw),
        "valExamples": len(val_raw),
        "epochs": NUM_EPOCHS,
        "wallClockSeconds": round(elapsed, 1),
        "peakGpuMemoryGB": round(peak_mem_after - peak_mem_before + peak_mem_before, 2),
        "finalTrainLoss": train_result.training_loss,
        "perEpochEvalLoss": per_epoch_eval_loss,
        "adapterPath": str(_OUTPUT_DIR / "final_adapter"),
    }
    _TRAINING_LOG_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
