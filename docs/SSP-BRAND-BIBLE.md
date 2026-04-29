# SSP BRAND BIBLE — Select Service Pros
# Last updated: April 12, 2026
# This is the SINGLE SOURCE OF TRUTH for brand, design, and pricing.
# Read this ENTIRE file at the start of every SSP session before writing ANY code.


## BRAND IDENTITY

# Name: Select Service Pros (SSP)
# Tagline: "Your Trusted Home Service Network"
# Domain: selectservicepros.com
# Parent company: Select Home Warranty (SHW)


## LOGO — LOCKED (do not modify)

# Type: Pin Drop icon + wordmark
# Pin Drop: Orange location pin (#f05528), white circle inside, orange checkmark inside circle
# Wordmark: "Select" (navy #0a1628) "Service" (orange #f05528) "Pros" (navy #0a1628)
# Font: DM Sans 800
# viewBox: "0 0 48 56"
# DO NOT propose logo changes. The logo is FINAL.

# Pin Drop SVG (use this exact markup):
# <svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
#   <path d="M24 0C10.745 0 0 10.745 0 24c0 6.5 2.6 12.4 6.8 16.7L24 56l17.2-15.3C45.4 36.4 48 30.5 48 24 48 10.745 37.255 0 24 0z" fill="#f05528"/>
#   <circle cx="24" cy="22" r="14" fill="#fff"/>
#   <path d="M17 22.5l4.5 4.5 9.5-9.5" stroke="#f05528" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
# </svg>


## TYPOGRAPHY

# Headings: Fraunces (weight 700, 800)
# Body / UI: DM Sans (weight 400, 500, 600, 700, 800)
# NEVER use Inter, Roboto, or Montserrat
# Google Fonts import:
# <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Fraunces:wght@700;800&display=swap" rel="stylesheet"/>


## COLOR SYSTEM

# Primary orange: #f05528 (buttons, CTAs, accents, "Service" in wordmark)
# Primary navy: #0a1628 (headings, dark sections, "Select"/"Pros" in wordmark)
# Orange hover: #d94a20
# Background: #f8f7f4 (warm off-white)
# Card background: #ffffff with 1px #e5e4e0 border
# Text primary: #111318
# Text secondary: #3d3f44
# Text tertiary: #6b6e76
# Green (success/verified): #1a8a4a
# Green light bg: #e6f9ed
# Red (error): #e53e3e
# Red light bg: #fee
# Border radius: 12px (cards), 8px (buttons/inputs)
# Shadow: 0 2px 12px rgba(0,0,0,.06)

# CSS Variables block (copy into every page):
# :root {
#   --orange: #f05528;
#   --orange2: #d94a20;
#   --navy: #0a1628;
#   --bg: #f8f7f4;
#   --white: #ffffff;
#   --border: #e5e4e0;
#   --text1: #111318;
#   --text2: #3d3f44;
#   --text3: #6b6e76;
#   --green: #1a8a4a;
#   --green-light: #e6f9ed;
#   --red: #e53e3e;
#   --red-light: #fee;
#   --radius: 12px;
#   --shadow: 0 2px 12px rgba(0,0,0,.06);
# }


## PAGE LAYOUT RULES

# Hero / top sections: Clean white background
# How It Works section: Navy (#0a1628) background, white text
# Footer: Navy (#0a1628) background, white/muted text, orange hover on links
# CTA banner: Orange gradient (135deg, #f05528 to #d94a20), white text
# Category icons: Each category has its own pastel bg + matching stroke color (defined in CSS)


## FILE STRUCTURE (Vercel repo: Davemoradi/selectservicepros-pages)

# Root files:
#   index.html              — Homepage (customer-facing)
#   contractor-signup.html   — Contractor signup flow (Stripe embedded checkout)
#   contractor-login.html    — Contractor login (Supabase Auth)
#   contractor-dashboard.html — Contractor portal (Supabase data)
#   ssp-config.js            — Plan pricing, Stripe keys, market config
#   package.json             — Dependencies
#   SSP-BRAND-BIBLE.md       — THIS FILE
#
# /api/
#   create-contractor.js     — Creates Supabase auth user + profile (replaces BD)
#   create-checkout-session.js — Stripe embedded checkout
#   verify-license.js        — TDLR license verification
#   next-question.js         — AI intake questions
#   ssp-config.js            — Server-side config
#   zip-lookup.js            — ZIP code lookup


## EXTERNAL SYSTEMS

# Vercel: davemoradis-projects/selectservicepros-pages (auto-deploys from GitHub main)
# GitHub: github.com/Davemoradi/selectservicepros-pages
# GHL: Sub-account QfDToN545k1TOpFZa5AQ
# GHL Webhook: https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c
# Stripe: Plans configured in ssp-config.js (test mode)
# Supabase: https://kasqtxwbsmjlisbnebku.supabase.co (West US Oregon, free tier)
# Domain: selectservicepros.com (GoDaddy → Cloudflare)
# Cloudflare: All HTML files need <!--email_off--> before <script> tags


## PLAN TIERS — MODEL A (source of truth)

# Basic:  $49/mo  + $39/lead,  30-min lead window
# Pro:    $99/mo  + $29/lead,  45-min lead window,  badge: "Most Popular"
# Elite:  $199/mo + $19/lead,  60-min exclusive first-access window

# Lead caps: 2–3 contractors max per lead
# No annual contracts
# Per-lead fee charged on delivery (not acceptance)
# Tiered routing: Elite gets exclusive window first, then Pro, then Basic

# Plan features:
# Basic:  Email lead alerts, public profile, 30-min window
# Pro:    Email + SMS alerts, Verified Pro badge, priority listing, 45-min window, seen before Basic
# Elite:  Email + SMS alerts, Verified Pro badge, priority listing, dedicated support, 60-min exclusive window, first access before everyone


## CONTRACTOR STATUS FLOW

# New → Paid → Verified / Pending / License Expired
# GHL custom fields: contractor_service_zips, contractor_services, contractor_membership_tier,
#   contractor_status, contractor_lead_count, contractor_acceptance_rate


## SESSION START CHECKLIST FOR CLAUDE

# 1. Read this file FIRST before writing any code
# 2. Use the EXACT logo SVG from this file — do not redesign
# 3. Use the EXACT CSS variables block — do not change colors
# 4. Use the EXACT font imports — do not substitute fonts
# 5. If editing a page, read the current version from GitHub/Vercel first
# 6. If creating a new page, copy CSS variables + nav + footer from index.html
# 7. Test changes against this file before delivering
# 8. Update this file if any brand decision changes (with David's approval)
# 9. Pricing source of truth is this file — not ssp-config.js, not Stripe
