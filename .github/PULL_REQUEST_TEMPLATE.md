## What and why
<!-- What does this change do, and why is it needed? Link the issue if there is one. -->

## Checklist
- [ ] Tests added/updated (bug fixes include a regression test)
- [ ] `make check` passes (ruff, pytest, `node --test tests/js/*.test.mjs`)
- [ ] Docs updated (README / `docs/` / `.env.example` / `CHANGELOG.md`) for anything user-visible
- [ ] Schema change → migration + migration test (never edit an old migration)
- [ ] No scraped data reaches `innerHTML` / inline handlers; CSP untouched (or `src/security.py` and `index.html` changed together)
