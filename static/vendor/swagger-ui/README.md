# Swagger UI distribution

Vendored from `swagger-ui-dist@5.33.1` (npm), upstream
https://github.com/swagger-api/swagger-ui, Apache-2.0 license in `LICENSE`.
Only the runtime bundle and stylesheet are shipped (no source maps required).

The API reference must work offline and under the application's strict CSP.
Initialization is in `static/js/api-docs.js`, never an inline script. No external
validator is contacted. Refresh these three upstream files together when updating;
verify `/api/docs`, CSP console errors, and `tests/test_api.py` afterwards.
