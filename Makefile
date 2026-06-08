.PHONY: setup-runtime smoke build lint check dev-backend dev-frontend health

setup-runtime:
	sh scripts/setup_runtime_dirs.sh

smoke:
	python3 scripts/smoke_check.py

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
	python3 scripts/health_check.py
