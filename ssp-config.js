const SSP_CONFIG = {
  categories: [
    { id: "HVAC", label: "HVAC", enabled: true },
    { id: "Plumbing", label: "Plumbing", enabled: true },
    { id: "Electrical", label: "Electrical", enabled: true },
    { id: "Roofing", label: "Roofing", enabled: true },
    { id: "Handyman", label: "Handyman", enabled: true },
    { id: "Appliance Repair", label: "Appliance Repair", enabled: true },
    { id: "Construction", label: "Remodeling", enabled: true },
    { id: "Painting", label: "Painting", enabled: true },
    { id: "Pool & Spa", label: "Pool & Spa", enabled: true },
    { id: "Windows & Doors", label: "Windows & Doors", enabled: true }
  ],
  markets: [
    { id: "houston-tx", city: "Houston", state: "TX", zips: ["770","773","774"], enabled: true },
    { id: "dallas-tx", city: "Dallas", state: "TX", zips: ["750","751","752","753"], enabled: true },
    { id: "san-antonio-tx", city: "San Antonio", state: "TX", zips: ["782","781"], enabled: true },
    { id: "austin-tx", city: "Austin", state: "TX", zips: ["787","786","785"], enabled: true },
    { id: "fort-worth-tx", city: "Fort Worth", state: "TX", zips: ["760","761","762"], enabled: true },
    { id: "orlando-fl", city: "orlando", state: "FL", zips: ["327","328","338","347"], enabled: true },
    { id: "new-york-ny", city: "New york", state: "NY", zips: ["070","071","072","073","074","075","076","077","079","088","100","101","102","103","104","105","106","107","108","109","110","111","112","113","114","115","116","117","118"], enabled: true }
  ],
  settings: {
    maxLeadsPerContractor: 3,
    eliteWindowMinutes: 60,
    proWindowMinutes: 45,
    basicWindowMinutes: 30,
    adminEmail: "dave@selecthomewarranty.com"
  }
};
if (typeof module !== 'undefined') module.exports = SSP_CONFIG;
if (typeof window !== 'undefined') window.SSP_CONFIG = SSP_CONFIG;
