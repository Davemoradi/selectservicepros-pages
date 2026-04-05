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
