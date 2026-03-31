export const config = { runtime: 'edge' };

// ZIP Codes API Proxy
// Fetches ZIP codes for a city/state from zip-codes.com
// API key is stored as Vercel env var ZIPCODE_API_KEY

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const city = url.searchParams.get('city');
    const state = url.searchParams.get('state');

    if (!city || !state) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: city and state',
        usage: '/api/zip-lookup?city=Houston&state=TX'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const apiKey = process.env.ZIPCODE_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ZIPCODE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Use zip-codes.com API to get ZIP codes by city/state
    const apiUrl = `https://api.zip-codes.com/ZipCodesAPI.svc/1.0/FindZipCodesInRadius?zipcode=&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&radius=30&minimumradius=0&key=${apiKey}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({
        error: 'zip-codes.com API error',
        status: response.status,
        details: errText
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();

    // Extract ZIP codes from response
    let zips = [];
    if (data && data.DataList) {
      zips = data.DataList.map(item => item.Code);
    } else if (Array.isArray(data)) {
      zips = data;
    }

    // Get unique 3-digit prefixes for the market config
    const prefixes = [...new Set(zips.map(z => z.substring(0, 3)))].sort();

    return new Response(JSON.stringify({
      city,
      state,
      total_zips: zips.length,
      zip_codes: zips,
      prefixes,
      prefix_count: prefixes.length
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
