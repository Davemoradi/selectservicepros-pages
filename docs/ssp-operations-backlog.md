# SSP Operations — Deferred Development Backlog

**Recorded:** 2026-10-09
**Project:** Select Service Pros (SSP)
**Scope:** Houston-first HVAC contractor and homeowner marketplace

## Current priority: Finish credential verification and insurance source integration

- Obtain Certificial Insurance Tracking API partnership, sandbox and production credentials, API documentation, webhook details, and pricing at pilot / growth volumes.
- Confirm which coverage signals are directly verified by an insurer/agent versus extracted from uploaded documents.
- Test genuine credential uploads, Texas TDLR verification, the full AI specialist workflow, human decisions, expirations, cancellation events, and source auditability.
- **Do not start the deferred work below until this credential-verification priority is completed or the user explicitly reprioritizes it.**

---

## Deferred work — User-requested notes (NOT started)

### 1. Leads — operations and assignment controls

- Ability for Operations to manually change a lead's status, with a required reason when overriding automated workflows and a complete employee/user timestamp history.
- Automatic lead status changes tied to real events, including matching, assignment, contractor offer, acceptance, failure to assign, cancellation and job outcome.
- Manual assignment/reassignment to an eligible contractor, including cases where automated matching failed; preview eligibility and financial effects before confirmation.
- Contractor eligibility gates: account Active, unsuspended, proper trade, licensed/insured as required, authorized service geography, capacity/availability, and customer consent requirements.
- Dedicated list and detail views with contractor/homeowner association, matching attempts, offers, communications, payment ledger, notes, and exception history.
- Prevent duplicate assignments, inconsistent statuses, double billing, unauthorized lead disclosure, and race conditions during auto/manual overrides.
- Backlog discovery: define the final lead lifecycle/state machine, escalation thresholds, automatic unassigned-lead alerts, retry policies, and scheduled follow-ups.
- Acceptance: manual action and automatic event updates remain consistent; audit log proves who changed the lead, when, why, and whether a contractor was billed.

### 2. Lead pricing and category activation

- Authorized Operations controls to edit per-category/tier pricing; display current price, proposed price, effective date, prior price and change history.
- Enable/disable lead categories and service/trade categories without breaking existing leads or offers. Clarify exact meaning of "category" (A/B/C quality tier vs. trade/service type) during requirements review.
- Configure city/state/trade-specific pricing and service availability where needed; guard against accidental nationwide pricing or disabled categories being sold.
- Consider margin guards, minimum/maximum price, promo/discount rules, price history on purchased leads, and pending-offer grandfathering.
- Role-restricted edits, confirmation before publishing, audit stamps, safe rollback and tests for wallet billing and matching.
- Acceptance: pricing shown to contractors, charged amounts, disputes and ledger stay consistent with the price version active when the offer was accepted.

### 3. Disputes — operations dashboard and AI agent

- Dedicated dispute center: filter by status, reason, lead, contractor, amount, assigned owner, deadline and evidence; linked task, notes, attachments and full timeline.
- AI dispute agent that retrieves only authorized lead/offer/charge/communication/policy evidence, investigates claims, detects contradictions and recommends a disposition with clear reasons and confidence.
- AI should draft replies, request missing evidence, and organize follow-ups, but **not autonomously issue credits/refunds or decide high-stakes financial outcomes**.
- Human approves or rejects recommendations; wallet/Stripe and lead/dispute statuses update atomically and are reconciled.
- Track root causes, dispute volumes, SLA compliance, outcomes and chargeback exposure.

### 4. Contractor 360: in-record actions and lifecycle statuses

- Provide all authorized actions inside the opened contractor record; staff should not leave the detail screen to update a company, contact, document review, service area, lead eligibility, or other permitted settings.
- Saving must confirm success, retain the current tab/record, show validation errors and preserve a user-stamped before/after audit trail.
- Add separate **Active / Suspended / Deactivated** contractor lifecycle statuses with explicit transition permissions.
- **Suspended:** Contractor can log in and access their account, but is categorically excluded from new lead offers/assignments/purchases; show the suspension status and reason prominently to the contractor and staff.
- **Deactivated:** Require a reason and timestamp. Decide whether login becomes read-only or disabled, and define reactivation/appeal rules before implementation. Never silently delete company or financial records.
- Required structured reason and optional supporting notes for both suspension and deactivation; include who changed status and why.
- Ensure matching, payment, notifications, eligibility, and existing open assignments enforce the lifecycle status **server-side**, not merely hide a UI button.
- Clarify whether a suspended contractor can continue to work already purchased leads; define policy and customer protection.
- Acceptance: each transition is testable end-to-end; no suspended/deactivated contractor can receive a new paid lead, while suspended accounts remain accessible.

### 5. City and state launch controls — both sides of SSP

- Central configuration to enable/disable supported **city + state** combinations (Houston, TX only at initial launch) without redeploying code.
- Enforce the same launch geography at contractor registration/onboarding, contractor service area configuration, homeowner intake, matching, and lead checkout.
- Validate city/state/ZIP combinations using reliable geospatial/ZIP data. Define boundaries: Houston city proper versus the surrounding Houston metro service area; don't guess.
- Give outside-area customers/contractors a clear availability message and optional interest/waitlist route rather than allowing unusable requests.
- Admin can expand city/state coverage deliberately, with time-stamped authorization, preview of service availability and safeguards against making the marketplace unintentionally nationwide.
- Acceptance: blocked city/state never produces a chargeable lead or an eligible assignment; enabling a city consistently updates both contractor and homeowner flows.

---

## Cross-cutting requirements

- Favor a small number of simple SSP Operations screens; no sprawling administrative menus.
- All meaningful actions need actor identity (human vs. AI), timestamp, old/new value, reason, and immutable evidence where appropriate.
- Background AI may triage, investigate and recommend, but financial/credential/permission decisions must use explicit, restricted approval workflows.
- Protect Supabase service-role credentials and personal data; enforce authorization at API and database boundaries.
- Double-check live database schemas before changes, avoid guessing, run code checks, rollback-only DB tests where suitable, and record any browser E2E tests not performed.

**Status:** Notes captured; features above are **not implemented by this document**. Do not automatically begin them.
