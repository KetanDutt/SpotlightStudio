# Contributing to Spotlight Studio

Thank you for your interest in contributing! This guide covers how to get started.

## 🛠️ Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/SpotlightStudio.git
cd SpotlightStudio

# 2. Create a virtual environment
python -m venv venv
venv\Scripts\activate       # Windows
# source venv/bin/activate  # Linux/macOS

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy and configure environment
copy .env.example .env

# 5. Start the dev server
python main.py --server
```

## 📁 Project Structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a detailed breakdown.

**Key files:**
- `src/scrapers.py` — Add or modify site scrapers here
- `src/downloader.py` — Image download and processing pipeline
- `src/engine.py` — Async engine coordination
- `src/database.py` — SQLite schema and queries
- `src/api.py` — FastAPI REST endpoints
- `index.html` — The complete single-file frontend (CSS + HTML + JS)

## 🐛 Reporting Bugs

Open a GitHub Issue with:
1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Python version and OS
5. Contents of `data/downloader.log` (if relevant)

## 💡 Feature Requests

Open a GitHub Issue labeled `enhancement` describing:
1. The use case
2. Proposed solution
3. Alternatives considered

## 🔧 Pull Request Guidelines

1. **Branch naming**: `feature/description`, `fix/description`, `docs/description`
2. **Commits**: Use clear, present-tense messages (`Add retry logic`, not `Added retry`)
3. **Tests**: Ensure the engine still runs and the UI loads correctly
4. **Docs**: Update `README.md` and relevant `docs/` files if your change affects user-facing behavior
5. **Changelog**: Add an entry to `CHANGELOG.md` under `[Unreleased]`

## 📐 Code Style

- **Python**: Follow PEP 8. Use `from __future__ import annotations`.
- **Type hints**: Required for all public functions.
- **Docstrings**: Brief description + param/return for non-trivial functions.
- **JS/CSS**: Maintain the existing design token system. No inline magic numbers.

## 📚 Adding a New Scraper Source

1. Create `async def scrape_<source>_page(session, url) -> list[dict]` in `src/scrapers.py`
2. Each dict must have: `image_url`, `page_url`, `title`, `source`, `tags`, `date_spotted`
3. Add a branch in `engine.py` `_scrape_one()` for the new source
4. Seed URLs in `database.py` `seed_scrape_queue()`
5. Add the source name to the UI filter dropdown in `index.html`

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).