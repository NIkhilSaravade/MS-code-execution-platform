"""Phase 6a: turns finetune/data/mined_raw.jsonl (real, mined GitHub PR
review comments) plus finetune/data/synthetic_raw.jsonl (LLM-generated,
see finetune/synth_augment.py) into the actual SFT training format this
model will be trained on: {"prompt": <rendered passed/failed_prompt
template>, "completion": <JSON string matching PassedAnalysis/
FailedAnalysis>}.

Real-partition reformatting is a disclosed, honest simplification, not
independent human labeling for this exact schema: a GitHub PR review
comment is about an arbitrary diff hunk, not a LeetCode-style problem, so
there is no real problem_description, and per-field content beyond
whatever the comment actually says is not knowable from a bare diff hunk
alone. Rather than fabricate a plausible-sounding time/space complexity or
edge-case list (which would teach the model to hallucinate those fields
confidently), unknowable fields are filled with an explicit
"not determinable from a partial diff" placeholder. The one field that IS
genuine, real signal - the substantive human comment itself - is what
actually varies per example and is where the model should learn tone/
substance from. This is a real dataset-design tradeoff, logged here and in
docs/ai-agent-build-log.md, not hidden.

Run: venv/Scripts/python.exe -m finetune.build_dataset
"""

import hashlib
import json
import random
import re
from pathlib import Path

from evals.golden_dataset import GOLDEN_DATASET
from prompts.failed_prompt import failed_prompt
from prompts.passed_prompt import passed_prompt

_THIS_DIR = Path(__file__).resolve().parent
_MINED_RAW_PATH = _THIS_DIR / "data" / "mined_raw.jsonl"
_SYNTHETIC_RAW_PATH = _THIS_DIR / "data" / "synthetic_raw.jsonl"
_MANIFEST_PATH = _THIS_DIR / "data" / "dataset_manifest.json"

N_REAL_SAMPLE = 460
SEED = 20260921
_NOT_DETERMINABLE = "not determinable from a partial diff"

_BUG_KEYWORDS = re.compile(
    r"\b(bug|fix|wrong|incorrect|broken|fails?|breaks?|crash|error|exception|"
    r"leak|typo|missing|should be|shouldn't|should not|doesn't work)\b",
    re.IGNORECASE,
)


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _stratified_sample(mined: list[dict], n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)  # nosec B311 - deterministic dataset sampling/shuffling, not security-sensitive
    by_repo: dict[str, list[dict]] = {}
    for ex in mined:
        by_repo.setdefault(ex["repo"], []).append(ex)

    total = len(mined)
    sampled = []
    for repo, items in by_repo.items():
        share = max(1, round(n * len(items) / total))
        rng.shuffle(items)
        sampled.extend(items[:share])
    rng.shuffle(sampled)
    return sampled[:n]


def _real_example_to_training_pair(ex: dict) -> dict:
    is_bug_report = bool(_BUG_KEYWORDS.search(ex["comment"]))
    code = ex["diff_hunk"]
    problem = "Code review for a real pull request diff (see submitted code)."

    if is_bug_report:
        completion = {
            "analysisType": "FAILED",
            "failureReason": ex["comment"].strip(),
            "debuggingSuggestion": _NOT_DETERMINABLE,
            "edgeCases": [],
            "hints": _NOT_DETERMINABLE,
        }
        prompt_text = failed_prompt.format(problem=problem, code=code, error="Unknown error")
    else:
        completion = {
            "analysisType": "PASSED",
            "timeComplexity": _NOT_DETERMINABLE,
            "spaceComplexity": _NOT_DETERMINABLE,
            "optimizationSuggestions": _NOT_DETERMINABLE,
            "codeSmells": ex["comment"].strip(),
            "alternativeApproach": _NOT_DETERMINABLE,
        }
        prompt_text = passed_prompt.format(problem=problem, code=code)

    return {
        "prompt": prompt_text,
        "completion": json.dumps(completion),
        "source": "real_reformatted",
        "origin": {"repo": ex["repo"], "pr_number": ex["pr_number"]},
    }


def _synthetic_example_to_training_pair(ex: dict) -> dict:
    return {
        "prompt": ex["prompt"],
        "completion": ex["completion"],
        "source": ex.get("source", "synthetic_generated"),
        "origin": {"bugClass": ex.get("bugClass"), "criticGated": ex.get("criticGated", False)},
    }


def _code_fingerprint(code: str) -> str:
    normalized = re.sub(r"\s+", " ", code.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def main():
    mined = _load_jsonl(_MINED_RAW_PATH)
    synthetic = _load_jsonl(_SYNTHETIC_RAW_PATH)

    sampled_real = _stratified_sample(mined, N_REAL_SAMPLE, SEED)
    real_pairs = [_real_example_to_training_pair(ex) for ex in sampled_real]
    synthetic_pairs = [_synthetic_example_to_training_pair(ex) for ex in synthetic]

    all_pairs = real_pairs + synthetic_pairs

    # Contamination check: none of Phase 3's golden/mutation-testing eval
    # examples (used again in Phase 6c to compare base vs. fine-tuned) may
    # appear in the training set, by exact-code-fingerprint match.
    eval_fingerprints = set()
    for entry in GOLDEN_DATASET:
        eval_fingerprints.add(_code_fingerprint(entry["correct_code"]))
        eval_fingerprints.add(_code_fingerprint(entry["mutation"]["mutated_code"]))

    contaminated = [
        p for p in all_pairs
        if _code_fingerprint(_extract_code_from_prompt(p["prompt"])) in eval_fingerprints
    ]
    all_pairs = [p for p in all_pairs if p not in contaminated]

    # Dedup: exact-duplicate (prompt, completion) pairs only - the real
    # partition can't be near-dup-detected cheaply at this volume without
    # an embedding pass, which is out of this phase's budget; logged as a
    # known gap, not hidden.
    seen_fingerprints = set()
    deduped = []
    for p in all_pairs:
        fp = hashlib.sha256((p["prompt"] + p["completion"]).encode("utf-8")).hexdigest()
        if fp not in seen_fingerprints:
            seen_fingerprints.add(fp)
            deduped.append(p)

    rng = random.Random(SEED)  # nosec B311 - deterministic dataset shuffling, not security-sensitive
    rng.shuffle(deduped)

    n = len(deduped)
    n_train = int(n * 0.8)
    n_val = int(n * 0.1)
    train = deduped[:n_train]
    val = deduped[n_train:n_train + n_val]
    test = deduped[n_train + n_val:]

    for name, split in [("train", train), ("val", val), ("test", test)]:
        path = _THIS_DIR / "data" / f"{name}.jsonl"
        with open(path, "w", encoding="utf-8") as f:
            for p in split:
                f.write(json.dumps(p) + "\n")

    manifest = {
        "totalMinedRaw": len(mined),
        "realSampled": len(sampled_real),
        "syntheticGenerated": len(synthetic_pairs),
        "totalBeforeDedup": len(real_pairs) + len(synthetic_pairs),
        "removedAsContaminatedWithEvalSet": len(contaminated),
        "removedAsExactDuplicates": (len(real_pairs) + len(synthetic_pairs)) - len(contaminated) - len(deduped),
        "finalTotal": n,
        "realToSyntheticRatio": f"{len(real_pairs)}:{len(synthetic_pairs)}",
        "splits": {"train": len(train), "val": len(val), "test": len(test)},
        "seed": SEED,
    }
    _MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps(manifest, indent=2))


def _extract_code_from_prompt(prompt_text: str) -> str:
    match = re.search(r"<submitted_code>\n(.*?)\n</submitted_code>", prompt_text, re.DOTALL)
    return match.group(1) if match else prompt_text


if __name__ == "__main__":
    main()
