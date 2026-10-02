# Security policy

## Supported versions

Only the latest release (currently **2.2.x**) receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead, e-mail **ketan6196@gmail.com** (the address in [LICENSE](LICENSE)) with:

* a description of the problem and its impact,
* steps to reproduce (a proof of concept helps),
* the affected version / commit and your OS.

You can expect an acknowledgement within a few days. Please give the maintainer reasonable time to ship a fix before disclosing details publicly.

## Scope

In scope: the Python backend (API, crawler, file handling), the web UI (XSS, CSP bypass), the service worker, and anything that exposes local data to other web pages or network users.

Out of scope: the third-party source sites themselves, the wallpapers' content, and attacks that require the operator to deliberately expose the unauthenticated API to an untrusted network (`HOST=0.0.0.0` without a reverse proxy — this is documented as unsafe).

The threat model, the implemented hardening and the known limitations are described in [docs/SECURITY.md](docs/SECURITY.md).
