# Export diagnostics to your own receiver

Open **Settings → General → View diagnostics** for the selected environment. Under
**OpenTelemetry export**, enter the OTLP HTTP endpoints for traces and metrics,
such as `http://localhost:4318/v1/traces`. Save, then restart that environment's server.
The receiver must be reachable from the server's machine. Clear an endpoint and save
to disable that export after a restart.

**Test** sends an empty export from the server. Saved endpoints are also checked
when the section opens. Checks use authentication headers only for the signal's
currently running endpoint and never follow redirects. To test a new endpoint that
requires authentication, save it and restart the server first.

Environment variables override saved settings. `T3CODE_OTLP_TRACES_URL` and
`T3CODE_OTLP_METRICS_URL` use `T3CODE_OTLP_HEADERS` and `T3CODE_OTLP_PROTOCOL`.
Standard `OTEL_EXPORTER_OTLP_*` endpoints use the corresponding standard headers
and protocol variables. The protocol can be `http/json` or `http/protobuf`.
