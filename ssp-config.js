// SSP Platform Configuration
// Edit this file to control which categories, cities, and states are active.
// The homepage and admin panel both read from this config.
// After editing, commit to GitHub — Vercel auto-deploys.

const SSP_CONFIG = {
  // === SERVICE CATEGORIES ===
  // Set enabled: true/false to show/hide categories on the homepage
  categories: [
    { id: "HVAC", label: "HVAC", enabled: true },
    { id: "Plumbing", label: "Plumbing", enabled: false },
    { id: "Electrical", label: "Electrical", enabled: false },
    { id: "Roofing", label: "Roofing", enabled: false },
    { id: "Handyman", label: "Handyman", enabled: false },
    { id: "Appliance Repair", label: "Appliance Repair", enabled: false },
    { id: "Construction", label: "Remodeling", enabled: false },
    { id: "Painting", label: "Painting", enabled: false },
    { id: "Pool & Spa", label: "Pool & Spa", enabled: false },
    { id: "Windows & Doors", label: "Windows & Doors", enabled: false }
  ],

  // === MARKETS (Cities/States) ===
  // Set enabled: true/false to activate/deactivate markets
  // The homepage will show the first enabled market as default
  markets: [
    { id: "houston-tx", city: "Houston", state: "TX", zips: ["770", "773", "774"], enabled: true },
    { id: "dallas-tx", city: "Dallas", state: "TX", zips: ["750", "751", "752", "753"], enabled: false },
    { id: "san-antonio-tx", city: "San Antonio", state: "TX", zips: ["782", "781"], enabled: false },
    { id: "austin-tx", city: "Austin", state: "TX", zips: ["787", "786", "785"], enabled: false },
    { id: "fort-worth-tx", city: "Fort Worth", state: "TX", zips: ["760", "761", "762"], enabled: false }
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

// Export for use in other files
if (typeof module !== 'undefined') module.exports = SSP_CONFIG;
if (typeof window !== 'undefined') window.SSP_CONFIG = SSP_CONFIG;
