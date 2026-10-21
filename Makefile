# Developer shortcuts (Linux / macOS / WSL / Git Bash).  Windows users: see docs/DEVELOPMENT.md.
PY ?= python3
VENV ?= .venv
BIN := $(VENV)/bin

.PHONY: help install run server crawl test lint check icons mobile browser site \
          roku-catalog roku-art roku-lint roku-check roku-zip roku-screensaver clean

help:  ## show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

install:  ## create .venv and install runtime + dev dependencies
	$(PY) -m venv $(VENV)
	$(BIN)/python -m pip install --upgrade pip setuptools
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

check: lint test  ## Python/Node checks (browser and mobile run separately)

icons:  ## regenerate the PWA + Expo icons (scripts/make_icons.py)
	$(BIN)/python scripts/make_icons.py

mobile:  ## install and verify the Expo app (mobile/ – needs Node ≥ 20)
	cd mobile && npm ci && npm run verify

browser:  ## real Chromium smoke tests (npm ci + npx playwright install chromium first)
	PYTHON=$(BIN)/python npm run test:browser

site:  ## build an allow-listed static site in dist/site
	$(PY) scripts/build_site.py

roku-catalog:  ## regenerate roku/assets/catalog.json from data/wallpapers.json
	$(PY) scripts/build_roku_catalog.py

roku-art:  ## flatten Roku splash/icons so they carry no transparency (cert 6.4)
	$(PY) scripts/flatten_roku_art.py

roku-lint:  ## BrightScript compile gate over both Roku packages
	cd scripts/roku && npm install --silent --no-audit --no-fund && npm run lint:all

roku-check:  ## certification pre-flight checks for both Roku packages (no artifacts)
	$(PY) scripts/package_roku.py --variant channel --check
	$(PY) scripts/package_roku.py --variant screensaver --check

roku-zip:  ## build the sideload-ready channel zip into dist/
	$(PY) scripts/package_roku.py --variant channel

roku-screensaver:  ## build the standalone screensaver zip into dist/
	$(PY) scripts/package_roku.py --variant screensaver

clean:  ## remove caches
	rm -rf .pytest_cache .ruff_cache && find . -name __pycache__ -type d -prune -exec rm -rf {} +
