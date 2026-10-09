# SSP Operations — Deferred Development Backlog

**Recorded:** 2026-10-09
**Project:** Select Service Pros (SSP)
**Scope:** Houston-first HVAC contractor and homeowner marketplace

## Launch decision (2026-10-09): Certificial integration ON HOLD

- The owner already contacted Certificial and is awaiting their response. Do not buy a plan or block SSP's Houston HVAC pilot on insurer API access.
- **Launch MVP for the first few contractors:** manually review the actual uploaded certificate, capture insurer/carrier, policy number, named insured, insurance type/limits if visible, effective date, expiration date, document version, and reviewer/date. Flag missing, illegible, expired or inconsistent fields. Keep the original source file accessible for review.
- License checks: retain official Texas TDLR public-data cross-check and attributable human review of current licensing, rather than relying on an AI guess.
- Treat **certificate reviewed**, **live coverage independently confirmed**, and **SSP approval** as different states. A future expiration date on a certificate is not proof a policy is currently in force. Do not silently bypass the existing production approval gate, which presently requires independent source confirmation recorded against the same private document.
- Keep expiration dates visible in Contractor 360 and a renewal/expiry queue. Set up automatic reminders and test that expiring/expired policies stop contractor eligibility according to the approved launch rules (not implemented by these notes).
- Perform an authenticated end-to-end pilot with genuine documents before calling onboarding ready. Keep the AI agent's evidence and fraud-flag suggestions, with human final decisions.
- **After the minimum manual credential process is tested, prioritize the lead/assignment and geographic launch controls below.** The broader insurance API can be resumed when Certificial replies and pricing/value justify the integration.

### Certificial follow-up — parked, not cancelled

- Obtain sandbox/production credentials, API docs, event notifications, limits, data provenance, and pricing for 25/100/1,000 monitored contractors.
- Clarify whether verified policy coverage is direct from an insurer/broker and how cancellations/renewals are reported.
- Do not implement or represent Certificial-based verification as live until credentials, access and the entire workflow are tested.

---

## Pilot eligibility decision

Owner approved a restricted Houston HVAC pilot exception (October 9, 2026). For eligible contractors, SSP may create HVAC lead offers after an uploaded certificate has been manually reviewed and its dates are current, even without a direct insurer API. A verified current Texas HVAC license, documented owner authorization, contractor agreement, and valid Houston service ZIP are required. Limit: 10 contractors, 60 days each. The database rechecks eligibility at offering and acceptance, blocking expired or revoked exceptions. Insurance verification remains a separate status. No contractors are approved automatically.

## Implementation checkpoint — 2026-10-09

**Built in Operations (initial functional release):**
- Contractor 360 pilot insurance certificate review: carrier, insured, policy, coverage, effective/expiry dates, outcome, comments, reviewer stamp, immutable review history.
- Explicit separation of uploaded certificate review from insurer/broker-backed active coverage verification; stale/missing private files cannot be recorded as successfully reviewed.
- Insurance expiry alerts (30-day window, including overdue), per-employee read/unread state, alert-to-task linking and automatic closure on recorded renewal more than 30 days out.
- Lead Operations detail: searchable historical leads, matching status, staff triage status (Needs Review / Follow Up / Ready / On Hold / Closed), active employee assignment, follow-up date, reason, and audit history. Matching status and payment fields are **not modified** by triage updates.
- New automatic audit events for actual lead matching status transitions.

**Not yet built/tested:** Paid manual contractor offers, lead retries, manual reassignments, adjustable pricing, dispute AI agent, full contractor status lifecycle, Houston service-area enforcement and genuine uploaded-document/browser end-to-end testing. Existing independent-insurance-confirmation activation safeguards remain enforced; no provisional activation override has been approved.

**Priority after these checks:** first safely complete manual matching/offer assignment and Houston launch availability restrictions, then pricing and dispute automation. Confirm Houston city limits versus broader Houston metro before enforcing geography.

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
