"""Phase 6c: does the fine-tune actually help? Runs Phase 3's golden/
mutation-testing eval set (evals/golden_dataset.py - held out of training,
verified by build_dataset.py's contamination check) against BOTH the base
model and the LoRA fine-tuned model, locally, same prompts, same decoding
settings - a fair, apples-to-apples comparison (neither side goes through
Groq/the hosted model; both are the same local base weights, one with the
adapter merged in and one without).

Reuses the same catch_keywords/false-positive-marker scoring Phase 3's
evals/run_eval.py used, so the numbers are directly comparable to that
phase's Groq-hosted-model numbers too (reported separately - three-way
comparison: hosted Groq model, local base model, local fine-tuned model).

Run: venv/Scripts/python.exe -m finetune.eval_finetune
"""

import json
import re
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from evals.golden_dataset import GOLDEN_DATASET
from prompts.failed_prompt import failed_prompt
from prompts.passed_prompt import passed_prompt

MODEL_ID = "Qwen/Qwen2.5-Coder-3B-Instruct"
MODEL_REVISION = "488639f1ff808d1d3d0ba301aef8c11461451ec5"  # see finetune/train_lora.py's comment
_THIS_DIR = Path(__file__).resolve().parent
# checkpoint-51 (end of epoch 1), not "final_adapter" (end of epoch 3) -
# training_log.json shows eval_loss actually INCREASED across epochs 2-3
# (0.944 -> 0.946 -> 0.995), a real overfitting signal on this dataset size
# (406 train examples). Standard best-checkpoint selection: use the epoch
# with the lowest validation loss, not blindly the last one. See
# docs/ai-agent-build-log.md's Phase 6 entry for the full loss curve.
_ADAPTER_PATH = _THIS_DIR / "checkpoints" / "qwen2.5-coder-3b-lora" / "checkpoint-51"
_RESULTS_PATH = _THIS_DIR.parent / "results" / "finetune_eval.json"

_FALSE_POSITIVE_MARKERS = ["bug", "incorrect", "wrong output", "will fail", "broken", "does not work", "doesn't work"]


def _load_model(with_adapter: bool):
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, quantization_config=bnb_config, device_map={"": 0}, dtype=torch.bfloat16,
    )
    if with_adapter:
        model = PeftModel.from_pretrained(model, str(_ADAPTER_PATH))
    model.eval()
    return model


def _generate(model, tokenizer, prompt: str, max_new_tokens: int = 400) -> str:
    messages = [{"role": "user", "content": prompt}]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output_ids = model.generate(
            **inputs, max_new_tokens=max_new_tokens, do_sample=False,
            pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
        )
    generated = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True)


def _clean_json(text: str) -> str:
    cleaned = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0) if match else cleaned.strip()


def _stringify(value) -> str:
    """A model not yet fine-tuned on this exact schema (i.e. the base model
    in this comparison) can produce a field of the wrong TYPE while still
    being valid JSON overall - e.g. edgeCases as a list of objects instead
    of strings. json.loads() alone doesn't catch that (unlike the real
    service's Pydantic validation - see services/analysis_service.py's
    _validate). Coerce rather than crash, since a schema-shape deviation
    like this is itself part of what's being measured (a fine-tuned model
    should produce fewer of these), not a reason to lose the whole case."""
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _text_from_failed(parsed: dict) -> str:
    parts = [parsed.get("failureReason", ""), parsed.get("debuggingSuggestion", ""), parsed.get("hints", "")]
    parts.extend(parsed.get("edgeCases", []) or [])
    return " ".join(_stringify(p) for p in parts).lower()


def _text_from_passed(parsed: dict) -> str:
    return " ".join(
        _stringify(parsed.get(k, "")) for k in ("codeSmells", "optimizationSuggestions", "alternativeApproach")
    ).lower()


def _run_model_over_golden_set(model, tokenizer, label: str) -> dict:
    caught = 0
    false_positives = 0
    parse_failures = 0
    per_case = []

    for entry in GOLDEN_DATASET:
        mutation = entry["mutation"]
        status = "FAILED" if mutation["correctness_affected"] else "PASSED"

        if status == "FAILED":
            prompt_text = failed_prompt.format(
                problem=entry["problem_description"], code=mutation["mutated_code"],
                error="Test case failed: unexpected output or runtime error.",
            )
        else:
            prompt_text = passed_prompt.format(problem=entry["problem_description"], code=mutation["mutated_code"])

        raw = _generate(model, tokenizer, prompt_text)
        hit = False
        try:
            parsed = json.loads(_clean_json(raw))
            text = _text_from_failed(parsed) if status == "FAILED" else _text_from_passed(parsed)
            hit = any(kw in text for kw in mutation["catch_keywords"])
        except json.JSONDecodeError:
            parse_failures += 1
        caught += int(hit)

        clean_prompt = passed_prompt.format(problem=entry["problem_description"], code=entry["correct_code"])
        clean_raw = _generate(model, tokenizer, clean_prompt)
        false_positive = False
        try:
            clean_parsed = json.loads(_clean_json(clean_raw))
            clean_text = _text_from_passed(clean_parsed)
            false_positive = any(m in clean_text for m in _FALSE_POSITIVE_MARKERS)
        except json.JSONDecodeError:
            parse_failures += 1
        false_positives += int(false_positive)

        per_case.append({"id": entry["id"], "bugClass": mutation["bug_class"], "caught": hit, "falsePositive": false_positive})
        print(f"  [{label}] {entry['id']}: caught={hit} falsePositive={false_positive}")

    n = len(GOLDEN_DATASET)
    return {
        "label": label,
        "catchRate": caught / n,
        "falsePositiveRate": false_positives / n,
        "jsonParseFailures": parse_failures,
        "perCase": per_case,
    }


def main():
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("Loading base model (no adapter)...")
    base_model = _load_model(with_adapter=False)
    base_results = _run_model_over_golden_set(base_model, tokenizer, "base")
    del base_model
    torch.cuda.empty_cache()

    print("Loading fine-tuned model (base + LoRA adapter)...")
    finetuned_model = _load_model(with_adapter=True)
    finetuned_results = _run_model_over_golden_set(finetuned_model, tokenizer, "finetuned")
    del finetuned_model
    torch.cuda.empty_cache()

    results = {"base": base_results, "finetuned": finetuned_results}
    _RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print()
    print(f"BASE       catch_rate={base_results['catchRate']:.2%} fp_rate={base_results['falsePositiveRate']:.2%} parse_failures={base_results['jsonParseFailures']}")
    print(f"FINE-TUNED catch_rate={finetuned_results['catchRate']:.2%} fp_rate={finetuned_results['falsePositiveRate']:.2%} parse_failures={finetuned_results['jsonParseFailures']}")
    print(f"wrote {_RESULTS_PATH}")


if __name__ == "__main__":
    main()
