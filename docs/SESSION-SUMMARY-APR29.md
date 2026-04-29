# SESSION SUMMARY — April 29, 2026

**Read order at start of every SSP session:**
1. This file (SESSION-SUMMARY-APR29.md)
2. SSP-VISION-AND-POSITIONING.md
3. SSP-BRAND-BIBLE.md (before writing any code)
4. SSP-MESSAGING-FRAMEWORK.md (before writing any customer-facing copy)

---

## What Changed This Session

This session restructured SSP from a joint SHW/David project into a **fully David-owned LLC**, and repositioned the brand as **"the anti-Angi/anti-Thumbtack contractor-first platform."** The denied-claim WF0 workflow is no longer critical path.

See `SSP-VISION-AND-POSITIONING.md` Section 10 (Decision Log) for the full strategic context.

---

## Current Top-of-Mind Priorities

### Tier 1 — Structural (do this week)
1. **File Texas LLC: Select Service Pros LLC.** TX Secretary of State, ~$300. Use David's address or registered agent service.
2. **Get EIN.** IRS.gov, free, 10 minutes after LLC is filed.
3. **Domain transfer from Joey.** selectservicepros.com is currently in Joey's GoDaddy account. Buy outright ($1-5K) or formalize as part of minority equity grant. Get assignment in writing.
4. **Morris + Joey heads-up conversation.** Disclose SSP becoming separate LLC. Don't ask permission. Don't open partnership negotiation unless Joey personally wants in as an investor. Script in vision doc.

### Tier 2 — Technical (existing checklist, still active)
5. **Fix Supabase anon key** in `contractor-login.html` and `contractor-dashboard.html` on GitHub. Old key ends `Meg0M`, correct key ends `NO8Yg`.
6. **Test Reset Password flow** end-to-end.
7. **Test GHL WF5 welcome email.**
8. **Full end-to-end signup test.**
9. **Fix catch block in signup page.**
10. **Align pricing** across all pages.
11. **Fix `contractor-signup.html`** — truncation issue + Cloudflare Email Protection issues still pending. Cloudflare fix pattern: wrap `<script>` tags in `<!--email_off-->...<!--/email_off-->`.

### Tier 3 — New positioning rollout (weeks 2-4)
12. **Build `/why-ssp.html`** — comparison table page (SSP vs Angi vs Thumbtack). See SSP-MESSAGING-FRAMEWORK.md Section 5.
13. **Build `/contractors.html`** — contractor recruitment landing page, separate funnel from homeowner homepage. Anti-Angi headlines. See messaging framework Section 3.
14. **Build `/quality-guarantee.html`** — published quality guarantee policy. See messaging framework Section 6.
15. **Homepage hero rewrite** — homeowner-facing, anti-Angi positioning. See messaging framework Section 4.
16. **Update `/faq-contractors.html`** to match new positioning.

### Tier 4 — Go-to-market (weeks 4-8)
17. **Contractor supply push.** Goal: 50-100 active TX contractors before turning on consumer marketing. Channels: SHW contractor network (with permission), Google Maps cold outreach, Facebook contractor groups, supply house partnerships.
18. **GHL outreach sequences** for cold contractor recruitment (email + SMS templates in messaging framework Section 7).
19. **Only after 50+ contractors live:** turn on Google LSA, Facebook ads, SEO push for homeowner acquisition.

### Deprioritized / Bonus
- **WF0 (denied-claim workflow).** Treat as a bonus channel that may or may not materialize. Nothing in SSP roadmap blocks on it. If SHW eventually builds it, SSP receives leads as a paid vendor.

---

## Existing Stack (Unchanged)

- **GitHub repo:** `Davemoradi/selectservicepros-pages`
- **Domain:** `selectservicepros.com` (currently Joey's, transfer pending)
- **Hosting:** Vercel (`www.selectservicepros.com` confirmed live)
- **DNS:** GoDaddy (migrated from BD nameservers)
- **Database/Auth:** Supabase project "Select Service Pros," URL `https://kasqtxwbsmjlisbnebku.supabase.co`, region West US Oregon, free tier. Tables: `contractors` + `leads` with RLS.
- **CRM/Workflows:** GoHighLevel, sub-account ID `QfDToN545k1TOpFZa5AQ`. WF5 sends contractor welcome email.
- **Payments:** Stripe (embedded checkout)
- **Vercel env vars:** `STRIPE_SECRET_KEY`, `BD_API_KEY` (legacy, can remove), `ZIPCODE_API_KEY`, `ANTHROPIC_API_KEY`
- **Serverless:** `create-contractor.js` (auto-confirms users with random password), `/api/next-question` (Anthropic-powered intake)

---

## Working Preferences (Unchanged)

- Always deliver complete code files or clear diffs — no truncated snippets.
- Numbered step-by-step instructions with exact URLs and button names for manual tasks.
- Never guess at file contents — always verify first.
- Prioritize momentum and revenue over polish and architecture.
- Strategic challenges and reordering suggestions offered proactively.

---

## Open Questions / Decisions to Make Soon

1. **Joey's role:** Buy domain outright (clean) or bring him in as 10-15% minority investor (if he contributes capital + strategic value). Default: buy outright.
2. **Warranty partner for Phase 2:** SHW (paid vendor agreement) or third-party warranty company. Decide before building Phase 2.
3. **Developer hire:** Solo build vs. bring in a developer. Decide based on revenue runway after first 50 contractors are live.
4. **Premium Contractor Network at SHW:** David continues at 25% rev share. Separate from SSP. Watch for any signal Morris/Joey want to wind it down or change terms.

---

## Where Things Stand (One Paragraph)

SSP has a working signup flow, custom Supabase contractor portal, AI-powered intake, deployed homepage, and locked brand system. The technical foundation is ~80% there. The strategic restructure (David-owned LLC + anti-Angi positioning) is decided as of this session and now needs to be operationalized: file the LLC, lock the domain, have the conversation with Morris and Joey, finish the existing tech checklist, then ship the three new positioning pages and start contractor recruitment in Texas. WF0 is off the critical path. The path to revenue is contractor supply first, then homeowner demand.
