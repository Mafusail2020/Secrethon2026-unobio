.PHONY: setup dev check lint test fe-check types types-check graph-spec llm-smoke spend

setup:
	cd backend && uv sync --extra ocr
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
	cd backend && uv run python -m scripts.export_openapi
	cd frontend && npm run types

types-check:
	@sh scripts/check-types.sh

graph-spec:
	cd backend && uv run python -m scripts.gen_graph_spec

llm-smoke:
	cd backend && uv run python -m scripts.llm_smoke

spend:
	cd backend && uv run python -m scripts.spend
