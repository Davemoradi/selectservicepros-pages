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

    // Use zip-codes.com API — first get ZIP info for the city, then do radius search
    // Step 1: Get a ZIP code for this city using QuickGetZipCodeDetails
    const infoUrl = `https://api.zip-codes.com/ZipCodesAPI.svc/1.0/FindZipCodesByCityState?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&key=${apiKey}`;

    const response = await fetch(infoUrl);

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

    const rawText = await response.text();
    // Strip BOM and clean the response
    const cleanText = rawText.replace(/^\uFEFF/, '').trim();
    
    let data;
    try {
      data = JSON.parse(cleanText);
    } catch(e) {
      return new Response(JSON.stringify({
        error: 'Failed to parse zip-codes.com response',
        raw: cleanText.substring(0, 500)
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check for API error response
    if (data.Error || data.ErrorCode) {
      return new Response(JSON.stringify({
        error: 'zip-codes.com returned an error',
        details: data.Error || data.ErrorMessage || data.ErrorCode,
        raw: data
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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
