# Developer shortcuts (Linux / macOS / WSL / Git Bash).  Windows users: see docs/DEVELOPMENT.md.
PY ?= python3
VENV ?= .venv
BIN := $(VENV)/bin

.PHONY: help install run server crawl test lint check icons clean

help:  ## show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

install:  ## create .venv and install runtime + dev dependencies
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -q -r requirements-dev.txt

run:  ## desktop window (PyWebView, falls back to the browser)
	$(BIN)/python main.py

server:  ## headless server on http://127.0.0.1:8765/
	$(BIN)/python main.py --server

crawl:  ## one-shot quick update without UI (cron friendly)
	$(BIN)/python main.py --crawl --mode quick

test:  ## Python + JavaScript unit tests
	$(BIN)/python -m pytest
	node --test tests/js/*.test.mjs

lint:  ## ruff
	$(BIN)/ruff check .

check: lint test  ## everything CI runs

icons:  ## regenerate static/icons from scripts/make_icons.py
	$(BIN)/python scripts/make_icons.py

clean:  ## remove caches
	rm -rf .pytest_cache .ruff_cache && find . -name __pycache__ -type d -prune -exec rm -rf {} +
