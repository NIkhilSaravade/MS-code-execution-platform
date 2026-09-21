"""Phase 6's ROI dashboard: reads real results JSON files
(results/phase3_eval.json, results/roi_metrics.json,
results/finetune_eval.json if present) and renders a single static HTML
file - no server, no external CDN dependency (dependency-free inline
SVG bars), reusing the "JSON results files + a script that regenerates a
static page from them" pattern the task brief points to. Never invents a
number that isn't in one of those files - a section is omitted (with a
visible "not yet run" note) rather than filled with a placeholder if its
source file doesn't exist yet.

Run: venv/Scripts/python.exe -m dashboard.generate_dashboard
"""

import json
from pathlib import Path

_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
_OUTPUT_PATH = Path(__file__).resolve().parent / "index.html"


def _load(name: str) -> dict | None:
    path = _RESULTS_DIR / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _bar(label: str, value: float, max_value: float, color: str, value_label: str) -> str:
    width_pct = 0 if max_value <= 0 else max(2, round(100 * value / max_value))
    return f"""
    <div class="bar-row">
      <div class="bar-label">{label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:{width_pct}%;background:{color}"></div></div>
      <div class="bar-value">{value_label}</div>
    </div>"""


def _section(title: str, body: str) -> str:
    return f'<section class="card"><h2>{title}</h2>{body}</section>'


def _missing_section(title: str, how_to_generate: str) -> str:
    return _section(title, f'<p class="missing">Not yet run. Generate with: <code>{how_to_generate}</code></p>')


def build_html() -> str:
    phase3 = _load("phase3_eval.json")
    roi = _load("roi_metrics.json")
    finetune_eval = _load("finetune_eval.json")

    sections = []

    if phase3:
        catch_bar = _bar("Catch rate", phase3["catchRate"] * 100, 100, "#3b82f6", f"{phase3['catchRate']:.0%}")
        fp_bar = _bar("False positive rate", phase3["falsePositiveRate"] * 100, 100, "#ef4444", f"{phase3['falsePositiveRate']:.0%}")
        judge = phase3["judge"]
        judge_bars = "".join([
            _bar("Helpfulness", judge["meanHelpfulness"], 5, "#10b981", f"{judge['meanHelpfulness']:.2f}/5"),
            _bar("Accuracy", judge["meanAccuracy"], 5, "#10b981", f"{judge['meanAccuracy']:.2f}/5"),
            _bar("Actionability", judge["meanActionability"], 5, "#10b981", f"{judge['meanActionability']:.2f}/5"),
        ])
        sections.append(_section(
            "Phase 3 eval: hosted Groq model (production path)",
            f'<p class="subtitle">n={phase3["datasetSize"]} golden-dataset mutations, real Groq calls through the full tool+critic pipeline.</p>{catch_bar}{fp_bar}{judge_bars}',
        ))
    else:
        sections.append(_missing_section("Phase 3 eval", "python -m evals.run_eval"))

    if roi:
        measured = roi["measured"]
        estimated = roi["estimated"]
        sections.append(_section(
            "ROI metrics (real, measured where marked)",
            f"""
            <div class="stat-grid">
              <div class="stat"><div class="stat-value">${measured['costPerReviewUsd']:.6f}</div><div class="stat-label">Cost per review (measured)</div></div>
              <div class="stat"><div class="stat-value">{measured['reviewsPerHour']:.0f}</div><div class="stat-label">Reviews/hour (measured, single-instance)</div></div>
              <div class="stat"><div class="stat-value">{estimated['engineerMinutesSavedPerReview']} min</div><div class="stat-label">Engineer time saved/review (ESTIMATE - see below)</div></div>
            </div>
            <p class="subtitle">Measured at {measured['measuredAt']} from a real live analyze() call
            ({measured['sampleInputTokens']} input / {measured['sampleOutputTokens']} output tokens,
            {measured['sampleWallClockSeconds']}s wall clock - includes any live rate-limit wait that happened to occur at measurement time).</p>
            <p class="assumption">⚠ Engineer-time-saved is an ASSUMPTION, not a measurement: {estimated['assumptionSource']}</p>
            """,
        ))
    else:
        sections.append(_missing_section("ROI metrics", "python -m dashboard.compute_roi_metrics"))

    if finetune_eval:
        base = finetune_eval["base"]
        ft = finetune_eval["finetuned"]
        sections.append(_section(
            "Phase 6 eval: local base model vs. LoRA fine-tuned model",
            f"""
            <p class="subtitle">Same golden-dataset eval set as Phase 3, run locally (not via Groq) - base weights vs. base weights + LoRA adapter, identical prompts/decoding.</p>
            {_bar("Base: catch rate", base['catchRate'] * 100, 100, "#94a3b8", f"{base['catchRate']:.0%}")}
            {_bar("Fine-tuned: catch rate", ft['catchRate'] * 100, 100, "#3b82f6", f"{ft['catchRate']:.0%}")}
            {_bar("Base: false positive rate", base['falsePositiveRate'] * 100, 100, "#94a3b8", f"{base['falsePositiveRate']:.0%}")}
            {_bar("Fine-tuned: false positive rate", ft['falsePositiveRate'] * 100, 100, "#ef4444", f"{ft['falsePositiveRate']:.0%}")}
            <p class="subtitle">JSON parse failures - base: {base['jsonParseFailures']}, fine-tuned: {ft['jsonParseFailures']}</p>
            """,
        ))
    else:
        sections.append(_missing_section("Phase 6 fine-tune eval", "venv/Scripts/python.exe -m finetune.eval_finetune"))

    body = "\n".join(sections)
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>ai-analysis-service ROI Dashboard</title>
<style>
  :root {{ --bg: #0b1120; --card: #111827; --text: #e5e7eb; --muted: #9ca3af; --border: #1f2937; }}
  body {{ font-family: -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem; }}
  h1 {{ font-size: 1.5rem; margin-bottom: 0.25rem; }}
  .generated-at {{ color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }}
  .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; max-width: 800px; }}
  h2 {{ font-size: 1.1rem; margin-top: 0; }}
  .subtitle {{ color: var(--muted); font-size: 0.85rem; }}
  .missing {{ color: var(--muted); }}
  code {{ background: #1f2937; padding: 0.15rem 0.4rem; border-radius: 4px; }}
  .bar-row {{ display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0; }}
  .bar-label {{ width: 170px; font-size: 0.85rem; flex-shrink: 0; }}
  .bar-track {{ flex: 1; background: #1f2937; border-radius: 6px; height: 14px; overflow: hidden; }}
  .bar-fill {{ height: 100%; border-radius: 6px; }}
  .bar-value {{ width: 70px; text-align: right; font-size: 0.85rem; flex-shrink: 0; }}
  .stat-grid {{ display: flex; gap: 1.5rem; flex-wrap: wrap; }}
  .stat {{ text-align: center; }}
  .stat-value {{ font-size: 1.4rem; font-weight: 600; }}
  .stat-label {{ color: var(--muted); font-size: 0.75rem; max-width: 160px; }}
  .assumption {{ color: #fbbf24; font-size: 0.85rem; }}
</style>
</head>
<body>
  <h1>ai-analysis-service ROI Dashboard</h1>
  <div class="generated-at">Generated by dashboard/generate_dashboard.py from results/*.json - real numbers, or an explicit "not yet run" note.</div>
  {body}
</body>
</html>
"""


def main():
    html = build_html()
    _OUTPUT_PATH.write_text(html, encoding="utf-8")
    print(f"wrote {_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
