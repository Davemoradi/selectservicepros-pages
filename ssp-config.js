// SSP Configuration — Phase 1: Pay-Per-Lead
// Last updated: 2026-04-07
// No membership fees. Contractors pay per accepted lead only.

const SSP_CONFIG = {

  // Lead pricing by category
  leadPricing: [
    { id: "hvac",             name: "HVAC",             leadPrice: 45, icon: "❄" },
    { id: "plumbing",         name: "Plumbing",         leadPrice: 35, icon: "🔧" },
    { id: "electrical",       name: "Electrical",       leadPrice: 30, icon: "⚡" },
    { id: "roofing",          name: "Roofing",          leadPrice: 65, icon: "🏠" },
    { id: "remodeling",       name: "Remodeling",       leadPrice: 75, icon: "🏗" },
    { id: "appliance-repair", name: "Appliance Repair", leadPrice: 20, icon: "🧊" },
    { id: "handyman",         name: "Handyman",         leadPrice: 19, icon: "🔨" },
    { id: "painting",         name: "Painting",         leadPrice: 35, icon: "🎨" },
    { id: "pool-spa",         name: "Pool & Spa",       leadPrice: 35, icon: "🏊" },
    { id: "windows-doors",    name: "Windows & Doors",  leadPrice: 45, icon: "🪟" },
  ],

  // How it works for contractors
  howItWorks: [
    { step: 1, title: "Sign up free",        desc: "Create your profile — no upfront costs, no contracts." },
    { step: 2, title: "Get lead alerts",      desc: "Receive notifications when a homeowner in your area needs help." },
    { step: 3, title: "Accept or pass",       desc: "Review the lead details. Only pay when you click Accept." },
    { step: 4, title: "Win the job",          desc: "Connect with the homeowner, give your quote, close the deal." },
  ],

  // Active markets
  markets: [
    { city: "Houston", state: "TX", enabled: true },
  ],

  // Stripe payment links for lead credit purchases (Phase 1 approach)
  // Contractors can pre-buy lead credits or pay-as-they-go via Stripe invoicing
  stripe: {
    // These will be set up as Stripe payment links for lead credit packs
    // For now, leads are invoiced through GHL after acceptance
    creditPacks: [
      { credits: 5,  discount: 0,   label: "5 leads"  },
      { credits: 10, discount: 5,   label: "10 leads (5% off)" },
      { credits: 25, discount: 10,  label: "25 leads (10% off)" },
    ],
    // Placeholder links — replace with real Stripe links
    buyCreditsLink: "#",
  },

  // GHL config
  ghl: {
    subAccountId: "QfDToN545k1TOpFZa5AQ",
    contractorWebhook: "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c",
  },

  // Feature flags
  features: {
    membershipTiers: false,  // Phase 1: disabled. Phase 2: enable when ready.
    valuePricing: false,     // Phase 2: enable for per-job-type pricing
    leadCredits: false,      // Enable when Stripe credit packs are set up
  },
};
