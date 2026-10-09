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
4. Unauthorized credential-check API request: HTTP 401. Direct service-role insurance/license approval was denied by DB triggers in rollback-only tests; negative verification (unverify) still works.
5. Anthropic API connectivity: successful.
6. All five model-role smoke tests passed on synthetic missing-document data: document, license, insurance, risk and supervisor returned structured JSON, requested source documents and did not claim independent verification.
7. Syntax checks on modified modules and dashboard. TDLR comparison tests included name mismatch, expired license, not found/unreachable and published-source date parsing.
8. Credential approval attempted without a real private file was denied by the database; rollback left no fixture records.
9. Insurance specialist was provided Texas TDLR Class A ($300k/$600k/$300k) and Class B ($100k/$200k/$100k) general-liability minima, with explicit requirement to confirm license class before comparing.

## Remaining acceptance tests / dependencies

- Upload a genuine licensed contractor PDF/image through contractor login; confirm all five agent stages, private file read, official registry match, evidence display, and human approval/denial on that exact document.
- Run credential-review actions from an authorized staff browser to verify interface and RLS end-to-end.
- Obtain a commercial insurer/broker-backed verification provider account, credentials, API specification, sandbox and webhook details. Certificial and TrustLayer are potential providers, not integrated yet.
- Completed all five isolated specialist model smoke tests against the latest deployment. A real uploaded document remains required for end-to-end acceptance.
- Add deployment gating so queued old builds never supersede newer verified builds.

**Never mark credentials verified based on an AI assessment or an uploaded certificate alone.**
