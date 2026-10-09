# SSP Credential Verification Integration — Release Notes

**Date:** 2026-10-09
**Scope:** Houston HVAC / Texas TDLR and insurance source checks

## Production architecture

- Contractor uploads use immutable private storage paths; replacements restart the review.
- Credential task and AI review are queued on upload (no contractor approval side effects).
- Five specialist agent steps: document, licensing, insurance, risk, supervisor.
- Texas license records are cross-checked with the official state-maintained Socrata dataset `7358-krk7` at `https://data.texas.gov/resource/7358-krk7.json`.
- Cross-check results save the candidate name, number, license type, expiration, source date, result, and caller. **A registry dataset match is not a guarantee of current license status.** Human reviewer must confirm current status using `https://www.tdlr.texas.gov/LicenseSearch/` and record an attributable attestation.
- Insurance: only direct insurer/broker confirmation with attributable evidence is available so far. **No insurer/Certificial/TrustLayer platform API credentials are configured**; do not claim coverage is verified automatically.
- Human-only approval with written reasons; stored source confirmation and unchanged private document required. AI cannot approve, reject, grant credits, or activate accounts.
- Private evidence tables have RLS enabled; direct public/authenticated access revoked.

## Tests completed

1. Live protected worker query to Texas's government dataset: HTTP 200, returned record matched by license number, correctly recognized expired license and dataset update date.
2. Unit checks: canonical name matching, mismatches, expired dates, date parsing, unavailable provider fail closed.
3. Human approval rejection without a real private source document: blocked via SQL transaction; test rows rolled back.
4. Unauthorized credential-check API request: HTTP 401.
5. Anthropic API connectivity: successful.
6. Model contract smoke with synthetic missing-document case: document and supervisor phases returned structured JSON, no independently verified claims.
7. Syntax checks on modified modules and dashboard.

## Remaining acceptance tests / dependencies

- Upload a genuine licensed contractor PDF/image through contractor login; confirm all five agent stages, private file read, official registry match, evidence display, and human approval/denial on that exact document.
- Run credential-review actions from an authorized staff browser to verify interface and RLS end-to-end.
- Obtain a commercial insurer/broker-backed verification provider account, credentials, API specification, sandbox and webhook details. Certificial and TrustLayer are potential providers, not integrated yet.
- Complete the remaining three isolated specialist model smoke tests against the latest deployment.
- Add deployment gating so queued old builds never supersede newer verified builds.

**Never mark credentials verified based on an AI assessment or an uploaded certificate alone.**
