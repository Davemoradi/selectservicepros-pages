# SSP Contractor Offer Notifications — GoHighLevel Setup
**Status:** Integration code added; production sending DISABLED until configured and verified.
**Date:** October 12, 2026

## GHL architecture
- SSP writes `lead_offer_created` (email) and, only when `notif_sms=true` at offer time, `lead_offer_created_sms` (text) outbox events.
- Background worker uses the GHL **sub-account** private integration token to upsert the contractor contact under that location and call `POST /conversations/messages`, type `Email` or `SMS`. Each channel has its own outbox ID and GHL message ID.
- Before contacting GHL, the worker checks that the offer has not expired, the contractor remains Active, geography/credential eligibility still holds, and the selected notification channel is permitted. It checks again directly before sending.
- Texts require `notif_sms = true` **and a recorded self-service SMS consent timestamp**. Existing contractor rows with only the old Boolean value must explicitly opt in again. SMS is never automatically enabled.
- The outbound message contains trade, approximate service ZIP, current offer price, expiry, and a secured contractor dashboard link. It does not include homeowner private contact information.
- Accepted HTTP response from GHL is recorded with `provider_message_id` / `provider_accepted_at`. This is NOT confirmation of delivery to the recipient.
- **No documented GHL idempotency guarantee for a repeated send:** the worker writes a send-start marker before attempting a message. Unknown/time-out outcomes are held for manual review instead of blindly retrying and risking duplicate texts. Explicit rate-limit rejections can be retried. Failed messages appear in Operations > Communications.
- The worker shares SSP's protected `/api/ai-worker` endpoint (`action=deliver_notifications`); the database cron job calls it each minute only when explicitly enabled in `ssp_notification_delivery_settings`.

## Required configuration (do not paste secrets into ChatGPT or source code)

1. Open the SSP **HighLevel sub-account** (not the parent agency), Settings > Private Integrations (location may differ by GHL UI; agency settings may provide access).
2. Create a private integration named `SSP Contractor Lead Notifications`, granting exactly:
   - `contacts.write` to upsert contractor contacts.
   - `conversations/message.write` to create SMS/email messages.
3. Record the SSP sub-account **Location ID**.
4. In Vercel > SSP project > Settings > Environment Variables (Production), configure:
   - `GHL_PRIVATE_INTEGRATION_TOKEN` — **Secret**, value of the GHL sub-account private integration token.
   - `GHL_LOCATION_ID` — location identifier for the SSP sub-account.
   - `GHL_FROM_NUMBER` — optional only if GHL needs a specific approved outbound text number, E.164 `+1...`.
   - `GHL_EMAIL_FROM` — optional GHL configured email sender.
5. Confirm outbound email configuration and U.S. **A2P/10DLC registration** for business texting at HighLevel > Settings > Phone System > Trust Center. A phone number being present is insufficient to guarantee SMS readiness.
6. Redeploy after Vercel environment values are set. Run a protected `notification_health` check, and a controlled, explicitly opted-in contractor test for both channels. Verify GHL message ID, receipt in GHL, no duplicate send and that existing valid offer/charge rules still hold.
7. Only after the successful live test, deliberately change `public.ssp_notification_delivery_settings.enabled` from `false` to `true` using authenticated, owner-controlled operations. **Do not enable prematurely.**
8. Configure/verify optional GHL delivery-status webhooks separately to distinguish accepted, delivered, failed and opt-out; webhooks are NOT implemented by this version.

Official API references:
- https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/index.html
- https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/
- https://marketplace.gohighlevel.com/docs/ghl/conversations/send-a-new-message/
- https://help.gohighlevel.com/support/solutions/articles/155000002380-what-is-a2p-10-dlc-brand-and-campaign-registration

## Test record
- Local code-level mock tests: GHL email and SMS request shapes, phone normalisation, opted-out SMS blocking, retry barrier after ambiguous sends, provider-accepted records, and no re-send when GHL message ID already exists.
- Rollback-only database test: an opted-in offer queued separate email + SMS events; no artificial outbox rows persisted.
- Authenticated contractor-update rollback test: a self-service SMS opt-in saves a provenance timestamp; existing imported Boolean preferences are not sufficient for SMS.
- Database schedule exists but dispatch function immediately returns NULL while integration is disabled.
- **Not yet verified:** A real successful GHL API call, account-specific sender and A2P configuration, production SMS/email provider acceptance or delivery; attached GHL connector returns 401 in this environment.

## Release semantics
- **Offered** is not **notification queued**.
- **Notification queued** is not **GHL accepted**.
- **GHL accepted** is not **delivered**.
- **Delivered** is not **contractor accepted**.
- **Contractor accepted** is the event that may trigger the wallet charge.
