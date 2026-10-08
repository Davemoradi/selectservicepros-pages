const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function adminEmails() {
  return new Set(
    String(process.env.SSP_ADMIN_EMAILS || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function requireAdmin(req) {
  if (!SUPABASE_SERVICE_KEY) {
    const e = new Error("server_misconfigured");
    e.status = 500;
    throw e;
  }

  const token = bearer(req);
  if (!token) {
    const e = new Error("missing_token");
    e.status = 401;
    throw e;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  const user = data && data.user;
  if (error || !user) {
    const e = new Error("invalid_token");
    e.status = 401;
    throw e;
  }

  const email = String(user.email || "").trim().toLowerCase();
  const appRole = user.app_metadata && user.app_metadata.role;
  if (appRole !== "admin" && !adminEmails().has(email)) {
    const e = new Error("admin_required");
    e.status = 403;
    throw e;
  }

  // A suspended or deactivated employee must not retain access through an old
  // email allowlist or a previously assigned app_metadata admin role.
  const { data: staff, error: staffError } = await supabase.from("operations_staff").select("employment_status").eq("email", email).maybeSingle();
  if (staffError) { const e = new Error("staff_check_failed"); e.status = 500; throw e; }
  if (staff && staff.employment_status !== "Active") {
    const e = new Error("staff_inactive"); e.status = 403; throw e;
  }
  return { supabase, user };
}

module.exports = { requireAdmin };
