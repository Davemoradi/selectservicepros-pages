export const config = { runtime: 'edge' };

// Texas License Verification API
// - TDLR (HVAC, Electrical): via Texas Open Data Socrata API
// - TSBPE (Plumbing): via TSBPE downloadable CSV data with manual lookup fallback

const SOCRATA_ENDPOINT = 'https://data.texas.gov/resource/7358-krk7.json';
const TSBPE_SEARCH_URL = 'https://vo.licensing.hpc.texas.gov/datamart/selSearchType.do';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let licenseNumber, name, licenseType, trade;

    if (req.method === 'POST') {
      const body = await req.json();
      licenseNumber = body.license_number || body.licenseNumber;
      name = body.name;
      licenseType = body.license_type || body.licenseType;
      trade = body.trade;
    } else {
      const url = new URL(req.url);
      licenseNumber = url.searchParams.get('license_number');
      name = url.searchParams.get('name');
      licenseType = url.searchParams.get('license_type');
      trade = url.searchParams.get('trade');
    }

    if (!licenseNumber && !name) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter. Provide license_number or name.',
        usage: {
          by_number: '/api/verify-license?license_number=12345',
          by_name: '/api/verify-license?name=John+Smith',
          by_trade: '/api/verify-license?name=John+Smith&trade=hvac',
          trade_values: ['hvac', 'electrical', 'plumbing', 'all'],
          note: 'trade=plumbing searches TSBPE. trade=hvac or electrical searches TDLR. Default searches all TDLR trades.'
        }
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tradeLower = (trade || '').toLowerCase();

    if (tradeLower === 'plumbing') {
      return await searchTSBPE(licenseNumber, name, corsHeaders);
    }

    if (tradeLower === 'all') {
      const [tdlrResult, tsbpeResult] = await Promise.all([
        searchTDLR(licenseNumber, name, licenseType, '', corsHeaders).then(r => r.json()),
        searchTSBPE(licenseNumber, name, corsHeaders).then(r => r.json()),
      ]);
      return new Response(JSON.stringify({
        verified: tdlrResult.verified || tsbpeResult.verified,
        tdlr: tdlrResult,
        tsbpe: tsbpeResult,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Default: TDLR search (hvac, electrical, or all TDLR trades)
    return await searchTDLR(licenseNumber, name, licenseType, tradeLower, corsHeaders);

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

// === TDLR Search (HVAC + Electrical) via Socrata Open Data API ===
async function searchTDLR(licenseNumber, name, licenseType, trade, corsHeaders) {
  const params = new URLSearchParams();
  params.set('$limit', '10');

  if (licenseNumber) {
    params.set('$where', `license_number='${licenseNumber.replace(/'/g, "''")}'`);
  } else if (name) {
    const cleanName = name.replace(/'/g, "''").toUpperCase();
    let whereClause = `upper(name) like '%${cleanName}%'`;

    if (licenseType) {
      whereClause += ` AND license_type='${licenseType.replace(/'/g, "''")}'`;
    } else if (trade === 'hvac') {
      whereClause += ` AND (license_type='A/C Contractor' OR license_type='A/C Technician')`;
    } else if (trade === 'electrical') {
      whereClause += ` AND (license_type like '%Electrician%' OR license_type like '%Electrical%')`;
    }

    params.set('$where', whereClause);
  }

  const apiUrl = `${SOCRATA_ENDPOINT}?${params.toString()}`;
  const response = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });

  if (!response.ok) {
    const errText = await response.text();
    return new Response(JSON.stringify({
      error: 'TDLR API request failed',
      status: response.status,
      details: errText,
      source: 'TDLR'
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const records = await response.json();
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

  return new Response(JSON.stringify({
    verified: results.length > 0,
    total_results: results.length,
    active_licenses: results.filter(r => r.status === 'ACTIVE').length,
    query: { license_number: licenseNumber || null, name: name || null, license_type: licenseType || null },
    results,
    source: 'Texas Department of Licensing and Regulation (TDLR)',
    covers: 'HVAC (A/C Contractors & Technicians), Electricians (Master, Journeyman, Apprentice, Contractor)'
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// === TSBPE Search (Plumbing) via downloadable CSV files ===
async function searchTSBPE(licenseNumber, name, corsHeaders) {
  const csvUrls = [
    { url: 'https://tsbpe.texas.gov/wp-content/uploads/data/RMP.csv', type: 'Responsible Master Plumber' },
    { url: 'https://tsbpe.texas.gov/wp-content/uploads/data/MasterPlumber.csv', type: 'Master Plumber' },
    { url: 'https://tsbpe.texas.gov/wp-content/uploads/data/JourneymanPlumber.csv', type: 'Journeyman Plumber' },
  ];

  let allResults = [];
  let csvAccessible = false;

  for (const csv of csvUrls) {
    try {
      const resp = await fetch(csv.url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;

      const text = await resp.text();
      const lines = text.split('\n');
      if (lines.length < 2) continue;

      csvAccessible = true;
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const searchTerm = (licenseNumber || name || '').toUpperCase();

      for (let i = 1; i < lines.length && allResults.length < 10; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        if (!line.toUpperCase().includes(searchTerm)) continue;

        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const record = {};
        headers.forEach((h, idx) => { record[h] = cols[idx] || null; });

        allResults.push({
          name: record['name'] || record['licensee name'] || (record['first name'] ? `${record['first name']} ${record['last name'] || ''}`.trim() : null),
          license_number: record['license number'] || record['license no'] || record['lic number'] || null,
          license_type: csv.type,
          business_name: record['company name'] || record['company'] || record['business name'] || null,
          city: record['city'] || null,
          state: record['state'] || 'TX',
          status: record['status'] || 'ACTIVE',
          expiration: record['expiration date'] || record['expiration'] || null,
        });
      }
    } catch (e) {
      continue;
    }
  }

  if (allResults.length > 0) {
    return new Response(JSON.stringify({
      verified: true,
      total_results: allResults.length,
      active_licenses: allResults.filter(r => (r.status || '').toUpperCase().includes('ACTIVE')).length,
      query: { license_number: licenseNumber || null, name: name || null },
      results: allResults,
      source: 'Texas State Board of Plumbing Examiners (TSBPE)',
      covers: 'Plumbing (Responsible Master Plumber, Master Plumber, Journeyman Plumber)',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Fallback — no results or CSV not accessible
  return new Response(JSON.stringify({
    verified: false,
    total_results: 0,
    query: { license_number: licenseNumber || null, name: name || null },
    results: [],
    source: 'Texas State Board of Plumbing Examiners (TSBPE)',
    manual_lookup: {
      url: TSBPE_SEARCH_URL,
      instructions: 'Select "Texas State Board of Plumbing Examiners" as the Board, choose "Plumbing - Licensed or Registered", then search by name or license number (numbers only, no rank letter prefix like M or J).',
    },
    note: csvAccessible
      ? 'No matching plumbing license found in TSBPE data. Try the manual lookup link.'
      : 'TSBPE data files were not accessible. Use the manual lookup link to verify plumbing licenses on the TSBPE website.'
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
