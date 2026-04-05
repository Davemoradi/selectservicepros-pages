// SSP Platform Configuration
// Edit this file to control which categories, cities, and states are active.
// The homepage reads from this config to render service cards and market info.
// After editing via the admin panel, commit to GitHub — Vercel auto-deploys.

const SSP_CONFIG = {

  // === SERVICE CATEGORIES ===
  // enabled: true/false controls whether the card shows on the homepage
  // displayName: what homeowners see on the card
  // meta: social proof line shown under the card title
  // icon: emoji shown on card
  categories: [
    {
      id: "HVAC",
      label: "HVAC",
      displayName: "AC Repair & Installation",
      icon: "❄️",
      meta: "★ 4.8 · 1,240 homeowners interested",
      enabled: true
    },
    {
      id: "Plumbing",
      label: "Plumbing",
      displayName: "Plumbing Repair",
      icon: "🔧",
      meta: "★ 4.7 · 980 homeowners interested",
      enabled: false
    },
    {
      id: "Electrical",
      label: "Electrical",
      displayName: "Electrical Services",
      icon: "⚡",
      meta: "★ 4.9 · 870 homeowners interested",
      enabled: false
    },
    {
      id: "Roofing",
      label: "Roofing",
      displayName: "Roofing",
      icon: "🏠",
      meta: "★ 4.7 · 720 homeowners interested",
      enabled: false
    },
    {
      id: "Handyman",
      label: "Handyman",
      displayName: "Handyman Service",
      icon: "🔨",
      meta: "★ 4.6 · 1,170 homeowners interested",
      enabled: false
    },
    {
      id: "Appliance Repair",
      label: "Appliance Repair",
      displayName: "Appliance Repair",
      icon: "🔌",
      meta: "★ 4.5 · 540 homeowners interested",
      enabled: false
    },
    {
      id: "Construction",
      label: "Remodeling",
      displayName: "Remodeling",
      icon: "🏗",
      meta: "★ 4.8 · 650 homeowners interested",
      enabled: false
    },
    {
      id: "Painting",
      label: "Painting",
      displayName: "Interior & Exterior Painting",
      icon: "🎨",
      meta: "★ 4.8 · 490 homeowners interested",
      enabled: false
    },
    {
      id: "Pool & Spa",
      label: "Pool & Spa",
      displayName: "Pool & Spa Services",
      icon: "🏊",
      meta: "★ 4.7 · 310 homeowners interested",
      enabled: false
    },
    {
      id: "Windows & Doors",
      label: "Windows & Doors",
      displayName: "Windows & Doors",
      icon: "🪟",
      meta: "★ 4.6 · 280 homeowners interested",
      enabled: false
    }
  ],

  // === MARKETS (Cities/States) ===
  // enabled: true activates the market — shows in nav and homeowner UI
  // The homepage displays the first enabled market as the active service area
  markets: [
    { id: "houston-tx",      city: "Houston",     state: "TX", zips: ["770","773","774"],         enabled: true  },
    { id: "dallas-tx",       city: "Dallas",      state: "TX", zips: ["750","751","752","753"],    enabled: false },
    { id: "san-antonio-tx",  city: "San Antonio", state: "TX", zips: ["782","781"],               enabled: false },
    { id: "austin-tx",       city: "Austin",      state: "TX", zips: ["787","786","785"],          enabled: false },
    { id: "fort-worth-tx",   city: "Fort Worth",  state: "TX", zips: ["760","761","762"],          enabled: false }
  ],

  // === MEMBERSHIP PLANS ===
  // Single source of truth for contractor tiers.
  // When you update here, manually mirror changes in BD Admin → Finance → Membership Plans.
  // bd_plan_id: the Brilliant Directories plan ID this maps to
  // stripeLink: the Stripe payment link for this tier
  plans: [
    {
      id: "elite",
      name: "Elite",
      bd_plan_id: 3,
      monthlyPrice: 499,
      leadPrice: 15,
      leadWindowMinutes: 60,
      stripeLink: "https://buy.stripe.com/REPLACE_ELITE_LINK",
      highlight: true,
      badge: "Most Popular",
      features: [
        "First access to every lead — 60 min exclusive window",
        "Lowest per-lead cost at $15",
        "Priority ranking in search results",
        "Dedicated account support",
        "Up to 3 leads matched per job"
      ]
    },
    {
      id: "pro",
      name: "Pro",
      bd_plan_id: 2,
      monthlyPrice: 249,
      leadPrice: 25,
      leadWindowMinutes: 45,
      stripeLink: "https://buy.stripe.com/REPLACE_PRO_LINK",
      highlight: false,
      badge: null,
      features: [
        "Second access — after Elite window closes",
        "$25 per lead",
        "Standard search ranking",
        "Email support",
        "Up to 3 leads matched per job"
      ]
    },
    {
      id: "basic",
      name: "Basic",
      bd_plan_id: 1,
      monthlyPrice: 99,
      leadPrice: 35,
      leadWindowMinutes: 30,
      stripeLink: "https://buy.stripe.com/REPLACE_BASIC_LINK",
      highlight: false,
      badge: null,
      features: [
        "Third access — after Pro window closes",
        "$35 per lead",
        "Standard search ranking",
        "Email support",
        "Up to 3 leads matched per job"
      ]
    }
  ],

  // === PLATFORM SETTINGS ===
  settings: {
    maxLeadsPerContractor: 3,
    eliteWindowMinutes: 60,
    proWindowMinutes: 45,
    basicWindowMinutes: 30,
    adminEmail: "dave@selecthomewarranty.com"
  }
};

// Export for Node / Vercel edge functions
if (typeof module !== 'undefined') module.exports = SSP_CONFIG;
// Expose on window for browser use
if (typeof window !== 'undefined') window.SSP_CONFIG = SSP_CONFIG;
