# SSP BRAND BIBLE — SINGLE SOURCE OF TRUTH
# Last updated: 2026-04-07
# Rule: Read this file at the start of every Claude session before touching any code.

## LOGO — PIN DROP (LOCKED)
# The logo is an orange location pin with a white circle containing an orange checkmark.
# Do NOT change this. Do NOT propose alternatives. It is final.

icon_svg: |
  <svg viewBox="0 0 48 56" fill="none">
    <path d="M24 2C13 2 4 11 4 22c0 14 20 32 20 32s20-18 20-32C44 11 35 2 24 2z" fill="#f05528"/>
    <circle cx="24" cy="20" r="12" fill="#fff"/>
    <path d="M18 20l4.5 4.5 7.5-7.5" stroke="#f05528" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>

nav_logo_html: |
  <a href="/" class="logo">
    <svg width="28" height="33" viewBox="0 0 48 56" fill="none">
      <path d="M24 2C13 2 4 11 4 22c0 14 20 32 20 32s20-18 20-32C44 11 35 2 24 2z" fill="#f05528"/>
      <circle cx="24" cy="20" r="12" fill="#fff"/>
      <path d="M18 20l4.5 4.5 7.5-7.5" stroke="#f05528" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>
      <span class="logo-select">Select</span>
      <span class="logo-service">Service</span>
      <span class="logo-pros">Pros</span>
    </span>
  </a>

footer_logo_html: |
  <div class="logo">
    <svg width="24" height="28" viewBox="0 0 48 56" fill="none">
      <path d="M24 2C13 2 4 11 4 22c0 14 20 32 20 32s20-18 20-32C44 11 35 2 24 2z" fill="#f05528"/>
      <circle cx="24" cy="20" r="12" fill="#fff"/>
      <path d="M18 20l4.5 4.5 7.5-7.5" stroke="#f05528" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>
      <span class="logo-select">Select</span>
      <span class="logo-service">Service</span>
      <span class="logo-pros">Pros</span>
    </span>
  </div>

wordmark_css: |
  .logo-select, .logo-pros { color: #0a1628; }
  .logo-service { color: #f05528; }
  /* Dark backgrounds (footer, navy sections): */
  .footer .logo-select, .footer .logo-pros { color: #ffffff; }


## COLORS — EXACT HEX VALUES (DO NOT DEVIATE)

primary_orange: "#f05528"
primary_orange_hover: "#d94a20"
primary_orange_light: "rgba(240,85,40,.08)"
primary_navy: "#0a1628"
navy_2: "#122240"
navy_3: "#1a3158"
green: "#1a8a4a"
green_light: "#e6f9ed"
background: "#f8f7f4"
white: "#ffffff"
text_primary: "#111318"
text_secondary: "#3d3f44"
text_tertiary: "#6b6e76"
text_quaternary: "#9ca0a8"
border_light: "#e5e4e0"
border_medium: "#d4d3cf"


## FONTS

display_font: "'Fraunces', serif"
display_weights: "600, 700, 800"
body_font: "'DM Sans', system-ui, sans-serif"
body_weights: "400, 500, 600, 700, 800"
google_fonts_url: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Fraunces:wght@600;700;800&display=swap"

# Usage rules:
# - Page headings (h1, h2): Fraunces, weight 700-800
# - Body text, labels, buttons: DM Sans
# - Wordmark "SelectServicePros": DM Sans, weight 800
# - NEVER use Inter, Roboto, Montserrat, or system defaults


## CSS VARIABLES (copy this block into every page)

css_variables: |
  :root{
    --navy:#0a1628;--navy2:#122240;--navy3:#1a3158;
    --orange:#f05528;--orange2:#d94a20;--orange-light:rgba(240,85,40,.08);
    --green:#1a8a4a;--green-light:#e6f9ed;
    --bg:#f8f7f4;--white:#ffffff;
    --text1:#111318;--text2:#3d3f44;--text3:#6b6e76;--text4:#9ca0a8;
    --border:#e5e4e0;--border2:#d4d3cf;
    --radius:12px;--radius-sm:8px;--radius-lg:16px;
    --shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
    --shadow-md:0 4px 12px rgba(0,0,0,.08);
    --shadow-lg:0 12px 40px rgba(0,0,0,.1);
    --font-display:'Fraunces',serif;
    --font-body:'DM Sans',system-ui,sans-serif;
    --max-w:1140px;
  }


## DESIGN SYSTEM RULES

# Hero / top of page: Clean white (#ffffff) background, no navy hero blocks
# Cards: White bg, 1px solid var(--border), border-radius 12-16px
# Buttons: Orange bg (#f05528), white text, 8px radius, DM Sans 700
# Button hover: #d94a20
# Page background: #f8f7f4 (warm off-white)
# How It Works section: Navy (#0a1628) background, white text, orange number circles
# Trust section: White bg, orange top-border accent on cards
# CTA banner: Orange gradient (135deg, #f05528 to #d94a20), white text
# Footer: Navy (#0a1628) background, white/muted text, orange hover on links
# Category icons: Each category has its own pastel bg + matching stroke color (defined in CSS)


## FILE STRUCTURE (Vercel repo: Davemoradi/selectservicepros-pages)

# Root files:
#   index.html              — Homepage (customer-facing)
#   contractor-signup.html  — Contractor pricing/signup page
#   ssp-config.js           — Plan pricing, Stripe links, market config
#   favicon.ico             — Browser tab icon (Pin Drop)
#   favicon-32x32.png       — PNG favicon
#   apple-touch-icon.png    — iOS home screen icon
#   SSP-BRAND-BIBLE.md      — THIS FILE
#
# /api/
#   next-question.js        — Vercel serverless function for AI intake questions
#
# /images/
#   ssp-icon.svg            — Pin Drop icon only
#   ssp-logo-full.svg       — Icon + wordmark (navy text, for light bg)
#   ssp-logo-white.svg      — Icon + wordmark (white text, for dark bg)
#   ssp-icon-512.png        — High-res PNG for BD portal / social media


## EXTERNAL SYSTEMS

# Vercel: davemoradis-projects/selectservicepros-pages (auto-deploys from GitHub main)
# GitHub: github.com/Davemoradi/selectservicepros-pages
# GHL: Sub-account QfDToN545k1TOpFZa5AQ
# GHL Webhook: https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c
# Stripe: Plans configured in ssp-config.js
# BD Portal: contractors.selectservicepros.com (ww2.managemydirectory.com admin)
# Domain: selectservicepros.com (GoDaddy)
# BD subdomain: contractors.selectservicepros.com


## PLAN TIERS (source of truth is ssp-config.js, but for reference):

# Basic:  $49/mo + $29/lead, 30-min window
# Pro:    $149/mo + $24/lead, 45-min window (badge: "Most Popular")
# Elite:  $399/mo + $19/lead, 60-min window


## SESSION START CHECKLIST FOR CLAUDE

# 1. Read this file FIRST before writing any code
# 2. Use the EXACT logo SVG from this file — do not redesign
# 3. Use the EXACT CSS variables block — do not change colors
# 4. Use the EXACT font imports — do not substitute fonts
# 5. If editing a page, read the current version from GitHub/Vercel first
# 6. If creating a new page, copy CSS variables + nav + footer from index.html
# 7. Test changes against this file before delivering
# 8. Update this file if any brand decision changes (with David's approval)
