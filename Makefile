.PHONY: setup dev check lint test fe-check types types-check graph-spec

setup:
	cd backend && uv sync
	cd frontend && npm install

dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && uv run uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

check: lint test fe-check types-check

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .

test:
	cd backend && uv run pytest -q

fe-check:
	cd frontend && npx tsc --noEmit && npx eslint . && npx vitest run

types:
	cd backend && uv run python scripts/export_openapi.py
	cd frontend && npm run types

types-check:
	@sh scripts/check-types.sh

graph-spec:
	cd backend && uv run python scripts/gen_graph_spec.py
