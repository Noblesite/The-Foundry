PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.PHONY: setup-runtime smoke build lint check dev-backend dev-frontend health

setup-runtime:
	sh scripts/setup_runtime_dirs.sh

smoke:
	$(PYTHON) scripts/smoke_check.py

build:
	cd EMA/frontend && npm run build

lint:
	cd EMA/frontend && npm run lint

check: setup-runtime smoke build lint

dev-backend:
	sh scripts/dev_backend.sh

dev-frontend:
	sh scripts/dev_frontend.sh

health:
	$(PYTHON) scripts/health_check.py
