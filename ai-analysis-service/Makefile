.PHONY: eval test mine-data build-dataset train-lora eval-finetune roi-metrics dashboard

eval:
	venv/Scripts/python.exe -m evals.run_eval

test:
	venv/Scripts/python.exe -m pytest tests/ -v

mine-data:
	venv/Scripts/python.exe -m finetune.mine_reviews
	venv/Scripts/python.exe -m finetune.synth_augment

build-dataset:
	venv/Scripts/python.exe -m finetune.build_dataset

train-lora:
	venv/Scripts/python.exe -m finetune.train_lora

eval-finetune:
	venv/Scripts/python.exe -m finetune.eval_finetune

roi-metrics:
	venv/Scripts/python.exe -m dashboard.compute_roi_metrics

dashboard: roi-metrics
	venv/Scripts/python.exe -m dashboard.generate_dashboard
