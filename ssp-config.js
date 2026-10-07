// SSP public configuration — wallet / limited-share model.
// No secrets, webhook URLs, tier pricing, subscription logic, or routing priority.
const SSP_CONFIG = Object.freeze({
  model: "prepaid_wallet",
  pricingVersion: "v1",
  offerWindowMinutes: 15,
  matchingWindowMinutes: 60,
  maxAcceptedContractors: 3,
  foundingPromoCents: 25000,
  markets: Object.freeze([
    Object.freeze({ city: "Houston", state: "TX", enabled: true })
  ]),
  plans: Object.freeze([])
});
if (typeof window !== "undefined") window.SSP_CONFIG = SSP_CONFIG;
if (typeof module !== "undefined") module.exports = SSP_CONFIG;