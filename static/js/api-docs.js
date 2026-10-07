/* Self-hosted API reference: no inline code, CDN dependency or external validator. */
"use strict";
window.ui = SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  displayRequestDuration: true,
  validatorUrl: null,
  persistAuthorization: false,
  presets: [SwaggerUIBundle.presets.apis],
});
