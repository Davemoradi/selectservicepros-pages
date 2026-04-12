// SSP Configuration — Model A: Low monthly + per-lead
// Last updated: 2026-04-12
// Pricing source of truth: SSP-BRAND-BIBLE.md
const SSP_CONFIG = {
  plans: [
    {
      id: "basic",
      name: "Basic",
      monthlyPrice: 49,
      leadPrice: 39,
      leadWindowMinutes: 30,
      badge: "",
      stripeLink: "#",
      features: [
        "Lead alerts via email",
        "Public contractor profile",
        "Up to 3 leads matched per job",
        "30-min lead access window"
      ]
    },
    {
      id: "pro",
      name: "Pro",
      monthlyPrice: 99,
      leadPrice: 29,
      leadWindowMinutes: 45,
      badge: "Most Popular",
      stripeLink: "#",
      features: [
        "Lead alerts via email + SMS",
        "Verified Pro badge",
        "Priority listing placement",
        "Up to 3 leads matched per job",
        "45-min lead access window",
        "Seen before Basic members"
      ]
    },
    {
      id: "elite",
      name: "Elite",
      monthlyPrice: 199,
      leadPrice: 19,
      leadWindowMinutes: 60,
      badge: "",
      stripeLink: "#",
      features: [
        "Lead alerts via email + SMS",
        "Verified Pro badge",
        "Priority listing placement",
        "Dedicated account support",
        "Up to 3 leads matched per job",
        "60-min exclusive first-access window",
        "First access — before everyone else"
      ]
    }
  ],
  markets: [
    { city: "Houston", state: "TX", enabled: true }
  ],
  ghl: {
    subAccountId: "QfDToN545k1TOpFZa5AQ",
    contractorWebhook: "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c"
  }
};
