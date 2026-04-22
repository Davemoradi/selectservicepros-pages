const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = "ssp2025";

// Keys we allow to be read/written through this endpoint.
// Anything not in this list is rejected — defense in depth so a misuse
// can't accidentally touch an unrelated config row (pricing, etc).
const ALLOWED_KEYS = new Set(["service_categories", "markets"]);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });
  }

  try {
    const body = req.body || {};
    if (body.password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid admin password" });
    }

    const action = body.action;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (action === "get") {
      // Fetch both known keys in one round trip
      const { data, error } = await supabase
        .from("platform_config")
        .select("key, value")
        .in("key", ["service_categories", "markets"]);
      if (error) {
        console.error("admin-config get error:", error);
        return res.status(500).json({ error: "Failed to read config: " + error.message });
      }
      const out = { service_categories: [], markets: [] };
      (data || []).forEach(row => { out[row.key] = row.value; });
      return res.status(200).json({ success: true, config: out });
    }

    if (action === "set") {
      const key = body.key;
      const value = body.value;
      if (!ALLOWED_KEYS.has(key)) {
        return res.status(400).json({ error: "Unknown config key: " + key });
      }
      if (!Array.isArray(value)) {
        return res.status(400).json({ error: "Config value must be an array" });
      }
      const { error } = await supabase
        .from("platform_config")
        .upsert({ key, value }, { onConflict: "key" });
      if (error) {
        console.error("admin-config set error:", error);
        return res.status(500).json({ error: "Failed to write config: " + error.message });
      }
      return res.status(200).json({ success: true, key, count: value.length });
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (err) {
    console.error("admin-config exception:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
