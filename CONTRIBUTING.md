# Contributing to Spotlight Studio

Thanks for your interest! Bug reports, fixes, documentation and ideas are welcome.

> **Licence note.** The repository is published under an *all rights reserved* licence (see [LICENSE](LICENSE)). By submitting a contribution you confirm that you wrote it (or are allowed to submit it) and that the project owner may use it as part of Spotlight Studio under the repository's licence terms. If that does not suit you, please open an issue to discuss first.

## Quick start

```bash
git clone https://github.com/<you>/SpotlightStudio.git && cd SpotlightStudio
python -m venv .venv && . .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
make check          # = ruff + pytest + node tests   (Windows: see docs/DEVELOPMENT.md)
```

Everything runs **offline**: the tests use a fake Peapix/Windows10Spotlight site, never the real ones and never your data. Please don't point a development server at the repository's own `data/` folder — the database and catalog are tracked in git (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)).

## Where things live

| You want to change… | Look at | Docs |
|---|---|---|
| how pages are parsed | `src/scrapers.py` + `tests/test_scrapers.py` | [ARCHITECTURE](docs/ARCHITECTURE.md), [DEVELOPMENT](docs/DEVELOPMENT.md#adding-a-source-site) |
| crawling, retries, modes | `src/engine.py`, `src/downloader.py` | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| the database / queries | `src/database.py` (+ a migration if the schema changes) | [DATA](docs/DATA.md) |
| the REST API | `src/api.py` | [API](docs/API.md) |
| the UI | `index.html`, `static/css/app.css`, `static/js/` | [FRONTEND](docs/FRONTEND.md) |

## Reporting bugs

Use the **Bug report** issue form. The most helpful reports contain: steps to reproduce, expected vs. actual behaviour, OS and Python version, the output of `python main.py --check` and the relevant lines of `data/downloader.log` (`LOG_LEVEL=DEBUG` for more).

For **security problems** please do *not* open a public issue — see [SECURITY.md](SECURITY.md).

## Pull requests

1. Branch from `main` (`fix/…`, `feature/…`, `docs/…`).
2. Keep the change focused; explain *why* in the description.
3. **Add or update tests** for every behaviour change (`pytest`, `node --test tests/js/*.test.mjs`). Bug fixes should come with a regression test that fails without the fix.
4. Run **`make check`** — CI runs the same on Python 3.10–3.13.
5. Update the docs for anything user-visible: README, the relevant file in `docs/`, `.env.example` (tests verify that every setting is documented) and a line under a new `## [Unreleased]` heading in `CHANGELOG.md`.
6. Schema change? Add a migration + migration test; never edit an existing migration.
7. Touching the version? Follow the checklist in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#releasing) — a test fails when versions disagree.

Commit messages: present-tense imperative subject (`Add retry back-off`), body explains the reasoning.

## Code style

* **Python**: PEP 8 via `ruff` (line length 100 is *not* enforced for docstrings/SQL), `from __future__ import annotations`, type hints on public functions, docstrings that explain intent. No import-time side effects; read settings at call time.
* **SQL**: always parameterised; the only dynamic fragments are whitelisted (see `_order_by`).
* **JavaScript**: no framework, no build step, ES2020, 2-space indent. Pure logic belongs in `core.js` (with a Node test); `app.js` only wires DOM and network. Never put scraped data into `innerHTML` and never add inline handlers or styles — the CSP forbids them.
* **CSS**: use the design tokens in `:root`; every interactive element needs a `:focus-visible` state; respect `prefers-reduced-motion`.

## Adding a source site

Step-by-step in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#adding-a-source-site).

## Code of conduct

Be kind and constructive. Harassment or discrimination of any kind is not tolerated.
