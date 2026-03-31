export const config = { runtime: 'edge' };

// TDLR License Verification API
// Queries the Texas Open Data (Socrata) API for TDLR license records
// Dataset: https://data.texas.gov/resource/7358-krk7
// Covers: A/C Contractors (HVAC), Electricians, and other TDLR-regulated trades
// Plumbing is under TSBPE (separate board) — not covered here

const SOCRATA_ENDPOINT = 'https://data.texas.gov/resource/7358-krk7.json';

export default async function handler(req) {
  // Handle CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let licenseNumber, name, licenseType;

    if (req.method === 'POST') {
      const body = await req.json();
      licenseNumber = body.license_number || body.licenseNumber;
      name = body.name;
      licenseType = body.license_type || body.licenseType;
    } else {
      const url = new URL(req.url);
      licenseNumber = url.searchParams.get('license_number');
      name = url.searchParams.get('name');
      licenseType = url.searchParams.get('license_type');
    }

    if (!licenseNumber && !name) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter. Provide license_number or name.',
        usage: {
          by_number: '/api/verify-license?license_number=12345',
          by_name: '/api/verify-license?name=John+Smith',
          by_type: '/api/verify-license?name=John+Smith&license_type=A/C Contractor',
          supported_types: [
            'A/C Contractor',
            'A/C Technician',
            'Electrician - Master',
            'Electrician - Journeyman',
            'Electrician - Apprentice',
            'Electrical Contractor',
          ]
        }
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build Socrata SoQL query
    let query = '';
    const params = new URLSearchParams();
    params.set('$limit', '10');

    if (licenseNumber) {
      // Search by license number (exact match)
      params.set('$where', `license_number='${licenseNumber.replace(/'/g, "''")}'`);
    } else if (name) {
      // Search by name (case-insensitive contains)
      const cleanName = name.replace(/'/g, "''").toUpperCase();
      let whereClause = `upper(name) like '%${cleanName}%'`;
      
      if (licenseType) {
        whereClause += ` AND license_type='${licenseType.replace(/'/g, "''")}'`;
      }
      params.set('$where', whereClause);
    }

    const apiUrl = `${SOCRATA_ENDPOINT}?${params.toString()}`;
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        // No app token needed for public data, but rate-limited to ~1000/hr without one
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({
        error: 'TDLR API request failed',
        status: response.status,
        details: errText
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const records = await response.json();

    // Format results
    const results = records.map(r => ({
      name: r.name || null,
      license_number: r.license_number || null,
      license_type: r.license_type || null,
      license_expiration: r.license_expiration_date || r.expiration_date || null,
      business_name: r.business_name || null,
      business_address: r.business_address || null,
      business_county: r.business_county || null,
      status: r.license_expiration_date
        ? (new Date(r.license_expiration_date) > new Date() ? 'ACTIVE' : 'EXPIRED')
        : 'UNKNOWN'
    }));

    const verified = results.length > 0;
    const activeResults = results.filter(r => r.status === 'ACTIVE');

    return new Response(JSON.stringify({
      verified,
      total_results: results.length,
      active_licenses: activeResults.length,
      query: { license_number: licenseNumber || null, name: name || null, license_type: licenseType || null },
      results,
      source: 'Texas Department of Licensing and Regulation (TDLR)',
      disclaimer: 'This data is sourced from the Texas Open Data Portal. Plumbing licenses are managed by TSBPE and are not included in this search.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: err.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
