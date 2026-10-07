# SSP → GHL Event Contract

**Version:** 1
**Producer:** `api/process-notifications.js` (the only component in SSP that calls GoHighLevel)
**Transport:** HTTPS POST, `Content-Type: application/json`
**Destination:** one env var, `GHL_SSP_EVENTS_WEBHOOK`

## Ownership

SSP emits events. **GHL configuration is not owned by SSP** — pipelines, stages, workflows, custom fields, tags, templates, and triggers are configured separately. This document defines only the payload crossing the boundary.

SSP makes no assumptions about pipeline ids, stage ids, workflow ids, custom-field ids, tag names, or template ids. None appear anywhere in SSP code.

---

## Envelope

Every event, without exception:

```jsonc
{
  "event_id":      "uuid",        // outbox row id — use for dedupe
  "event_type":    "string",      // see catalogue
  "event_version": 1,
  "occurred_at":   "ISO-8601",    // when the DB emitted it, not when sent
  "environment":   "production" | "preview" | "development",
  "source":        "ssp",
  "contractor_id": "uuid|null",
  "lead_id":       "uuid|null",
  "offer_id":      "uuid|null",
  "data":          { }            // per-type, below
}
```

**Deduplicate on `event_id`.** Delivery is at-least-once. A webhook that times out after processing will be retried, and the same `event_id` will arrive twice. SSP guarantees the event is enqueued exactly once; it cannot guarantee it is *delivered* exactly once.

**`environment` is not decoration.** Preview deployments emit real events. Filter on it or test traffic reaches production contacts.

### Delivery behaviour

| | |
|---|---|
| Success | any 2xx |
| Retried | 429, any 5xx, timeout, network error |
| Not retried | 4xx other than 429 — dead-lettered immediately |
| Timeout | 10s |
| Max attempts | 6, then dead-letter |
| Backoff (offer events) | 10s, 30s, 60s, 120s, 240s + jitter |
| Backoff (all others) | 30s, 2m, 10m, 30m, 2h + jitter |

Offer backoff is compressed deliberately: an offer expires in 15 minutes, so a notification delivered on a 30-minute backoff would announce something already gone.

**Return 2xx as soon as you have accepted the event.** Doing slow work before responding will trip the 10s timeout and cause a duplicate.

---

## PII policy

The hard rule for **contractor-facing events**: homeowner PII appears only after that contractor has paid for the lead. SSP-internal homeowner lifecycle events may carry the minimum contact data needed for CRM/transactional communication.

| Event | Homeowner PII |
|---|---|
| `lead_submitted` | name + email + phone + locality — **SSP internal only; never route this event to contractors** |
| `lead_offer_created` | **none** — structured fields only |
| `lead_accepted` | full contact details |
| `lead_unmatched` | homeowner name + email (SSP apologises to them) |
| all `contractor_*` | contractor contact only |

`lead_offer_created` never contains homeowner name, phone, email, street address, or the free-text description. That text is homeowner-authored and routinely contains a phone number or address, which is exactly why it is withheld. A contractor sees category, issue, urgency, ZIP, price, and expiry — enough to decide, not enough to bypass the charge.

Enforced at the database level in `emit_lead_offer_created()`, and asserted by `scripts/verify-ssp-hardening.js`.

---

## Event catalogue

### `contractor_created`
Fires on contractor row insert. **Idempotency:** `contractor_created:v1:<contractor_id>` — permanent, so the Stripe-webhook signup race cannot produce two welcomes.

```jsonc
"data": {
  "contractor_id": "uuid", "email": "string", "first_name": "string|null",
  "last_name": "string|null", "company_name": "string|null",
  "phone": "string|null", "status": "string"
}
```

### `contractor_submitted_for_review`
Status → `Pending Review`.

### `contractor_approved`
Status → `Active`. The contractor can now receive offers.

### `contractor_rejected`
Status → `Rejected`.

### `contractor_suspended`
Status → `Suspended`.

### `contractor_deletion_requested`
Status → `Deletion Requested`. **A request, not a deletion.** Records may be retained where legally required.

All five lifecycle events share:

```jsonc
"data": {
  "contractor_id": "uuid", "email": "string",
  "first_name": "string|null", "last_name": "string|null",
  "company_name": "string|null", "phone": "string|null",
  "previous_status": "string", "status": "string"
}
```

**Idempotency:** `<event_type>:v1:<contractor_id>:<transition_nonce>`. The transition nonce is deliberate — a contractor may legitimately be suspended and later reinstated, and a permanent key would silently swallow future valid transitions.

### `lead_submitted`
A homeowner completed the intake. Fires once whether the final lead was inserted directly or finalized from a `Partial` row. **Idempotency:** `lead_submitted:v1:<lead_id>`.

This is an SSP-internal CRM/transactional event. It must never be used as a contractor-notification trigger. The free-text description is deliberately omitted even here.

```jsonc
"data": {
  "lead_id": "uuid",
  "homeowner_name": "string",
  "homeowner_email": "string|null",
  "homeowner_phone": "string",
  "homeowner_zip": "77001",
  "homeowner_city": "Houston|null",
  "homeowner_state": "TX|null",
  "service_category": "HVAC|null",
  "service_type": "AC not cooling",
  "issue_code": "string|null",
  "urgency": "Emergency|Soon|Planning",
  "status": "Priced|HeldForReview"
}
```

GHL may use this event to upsert the homeowner as `ssp-homeowner` and send an acknowledgement, subject to channel consent. It must not create a contractor sales opportunity yet.

### `lead_offer_created`
A lead was offered to a contractor. Fires on **every** creation path: original matching, decline/refill, and future cron refill — because it is a database trigger on insert, not a call in one handler.

**Idempotency:** `lead_offer_created:v1:<offer_id>` — permanent, one offer per contractor per lead.

```jsonc
"data": {
  "offer_id": "uuid", "lead_id": "uuid", "contractor_id": "uuid",
  "contractor_email": "string", "contractor_phone": "string|null",
  "contractor_first_name": "string|null",
  "notif_email": true, "notif_sms": false,     // respect these
  "service_category": "HVAC", "service_type": "AC not cooling",
  "issue_code": "string|null", "urgency": "string|null",
  "zip": "77001", "price_cents": 7500,
  "expires_at": "ISO-8601",
  "deep_link": "https://www.selectservicepros.com/contractor-dashboard.html?tab=leads&lead=<id>&action=accept"
}
```

Two things matter here:

**Honour `notif_email` / `notif_sms`.** `notif_sms` defaults false and is opt-in only. Sending SMS to a contractor who has not opted in is a compliance problem, not a UX one.

**The deep link is navigation only.** It opens the dashboard, scrolls to the offer, and highlights it. `action=accept` is *not* an instruction — a GET never accepts or charges. Accepting requires an authenticated POST from a signed-in session. Do not build anything that treats following the link as acceptance.

Before sending, the worker re-checks that the offer is still `offered`, unexpired, the lead still `Offering` within its matching window, and the contractor still `Active`. Otherwise the event is marked `obsolete` and never sent.

### `lead_accepted`
A contractor accepted and the wallet debit committed. **Idempotency:** `lead_accepted:v1:<offer_id>`.

Emitted by a trigger inside the same transaction as the debit, so it cannot be lost if the process dies after committing, and cannot fire twice on retry.

```jsonc
"data": {
  "offer_id": "uuid", "lead_id": "uuid", "contractor_id": "uuid",
  "transaction_id": "uuid", "price_cents": 7500, "accepted_at": "ISO-8601",
  "contractor_first_name": "...", "contractor_last_name": "...",
  "contractor_company": "...", "contractor_phone": "...", "contractor_email": "...",
  "homeowner_name": "...", "homeowner_email": "...", "homeowner_phone": "...",
  "homeowner_address": "...", "homeowner_zip": "77001",
  "service_category": "HVAC", "service_type": "AC not cooling", "urgency": "Emergency"
}
```

This is the event that tells the homeowner who is coming. **Contains full homeowner PII** — handle accordingly.

### `lead_unmatched`
Matching window closed with zero accepts. **Idempotency:** `lead_unmatched:v1:<lead_id>`.

```jsonc
"data": {
  "lead_id": "uuid", "service_category": "...", "service_type": "...",
  "zip": "77001", "price_cents": 7500,
  "homeowner_email": "...", "homeowner_name": "..."
}
```

Every one of these is an operational signal, not just a message to send — it means no funded, Active, in-area contractor took the job.

---

## Not emitted yet

`lead_declined`, `lead_offer_expired`, `wallet_topup`, `wallet_low_balance`, `lead_disputed`, `dispute_resolved`. The outbox supports them; no triggers exist. Adding one is a trigger plus a catalogue entry — no worker change.

## Environment variables

| Name | Used by |
|---|---|
| `GHL_SSP_EVENTS_WEBHOOK` | worker only — the single GHL integration point |
| `NOTIFICATION_WORKER_SECRET` | worker auth |
| `SUPABASE_SERVICE_ROLE_KEY` | worker + endpoints |

Retired: `GHL_HOMEOWNER_MATCHED`, `GHL_REVIEW_WEBHOOK`, and the two literals formerly in `create-contractor.js`. Running the old direct webhooks alongside the outbox would double-send.