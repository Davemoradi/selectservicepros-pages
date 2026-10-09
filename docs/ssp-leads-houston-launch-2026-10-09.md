# SSP Houston HVAC launch — Lead offers and market controls
**Recorded:** October 9, 2026

## Implemented
1. **Manual contractor offer** in Operations > Leads > a lead record:
   - Owner can request live eligible contractor candidates and select a contractor.
   - Eligibility checks active status, required licensing/insurance or pilot authorization, open matching window, trade, ZIP, active launch market, wallet >= lead price, prior offers, and available offer slots.
   - Sending inserts an offer through the SAME `lead_offers` and notification-outbox trigger used by automatic matching. Offer price is the lead's existing snapshot; no editing or price re-negotiation.
   - Contractor wallet is NOT debited when an offer is created; the existing acceptance workflow applies the charge. The max of three accepted/live offers and the one-offer-per-lead-per-contractor rule are preserved.
   - A reason and authenticated owner identity are recorded in `operations_lead_events`. A duplicate manual offer or closed lead is blocked by the database.
   - **Notification outbox is queued but successful external delivery has not been verified.** Do not interpret "offer created" as "contractor notified."

2. **Launch availability**:
   - Database-backed `ssp_market_service_areas` has Houston, TX / HVAC / 770xx enabled.
   - Owner controls the enabled flag and provides a required reason, recorded in `ssp_market_area_events`.
   - Homeowner intake checks the market on the first step using a public read-only endpoint and again server-side before saving a partial or final lead.
   - New contractor signups must offer at least one enabled trade and ZIP; existing registrations are unaffected.
   - Automatic matching, manual offers, and offer acceptance enforce enabled-market eligibility server-side.
   - **770xx is a starter postal-prefix filter, NOT a precise map of Houston city limits.** When homeowner city/state is provided, conflicting values are rejected. Google Places key is currently blank in the homeowner intake, so it cannot independently prove city boundaries.
   - Homepage now discloses Houston-area HVAC as the initial launch market.

## Safeguards and evidence
- Database permission checks: privileged market tables and manual offer RPCs are inaccessible to anon/authenticated users directly; only server-held service-role + verified owner API authorizes them.
- Rollback-only SQL tests: manual offer successful; lead enters Offering; notification event queued; wallet balance unchanged; duplicate offer rejected; candidate list detects adequate/insufficient wallet; area enable/disable and wrong city/state/trade/ZIP detected; all temporary data rolled back.
- Five touched JavaScript files syntax parsed; public /api/create-lead?action=market_areas returned live 200 with Houston TX HVAC / 770.
- Additional rollback-only financial safety test: a valid priced offer was created, the Houston market was switched off before contractor acceptance, the acceptance was blocked, and neither wallet balances nor wallet transaction counts changed.
- No real contractor was assigned, offered, charged or sent synthetic notifications in committed production data.

## Remaining launch acceptance work
- Check a real authenticated Operations session for candidate selection and manual offer, including source and notification status.
- Complete genuine contractor onboarding/credential review and payment/wallet acceptance test in a controlled environment.
- Verify the notification outbox is actively dispatched and receipts, failed delivery retries, and email/SMS are monitored; at inspection no active database cron job for outbox delivery was observed. Do not promise actual offer delivery yet.
- Replace postal-prefix coverage with validated city/ZIP or polygon-based launch boundaries and a configured address-validation provider.
- Add contractor suspend/deactivate lifecycle rules and precise lead status updates, then editable pricing version rules and AI-assisted dispute operations.

**Release principle:** Offer creation != delivery != contractor acceptance != wallet debit. Each event must be separately evidenced.
