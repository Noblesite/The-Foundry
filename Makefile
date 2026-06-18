PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.PHONY: setup-runtime smoke backend-test build lint test check dev-backend dev-frontend health mvp-demo

setup-runtime:
	sh scripts/setup_runtime_dirs.sh

smoke:
	$(PYTHON) scripts/smoke_check.py

backend-test:
	$(PYTHON) scripts/test_foundry_workflow_contract.py
	$(PYTHON) scripts/test_foundry_api_workflow_contract.py
	$(PYTHON) scripts/test_foundry_archive_api_contract.py
	$(PYTHON) scripts/test_foundry_construct_diagnostics_api_contract.py

build:
	cd EMA/frontend && npm run build

lint:
	cd EMA/frontend && npm run lint

test:
	cd EMA/frontend && npm test

check: setup-runtime smoke backend-test build lint test

dev-backend:
	sh scripts/dev_backend.sh

dev-frontend:
	sh scripts/dev_frontend.sh

health:
	$(PYTHON) scripts/health_check.py

mvp-demo:
	$(PYTHON) scripts/health_check.py
	$(PYTHON) scripts/run_mvp_manual_rehearsal.py
