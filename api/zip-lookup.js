export const config = { runtime: 'edge' };

// ZIP Codes API Proxy — finds all ZIP codes near a city
// Accepts: zip (reference ZIP code) OR city+state
// Uses zip-codes.com API (key stored in Vercel env ZIPCODE_API_KEY)

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const url = new URL(req.url);
    let zip = url.searchParams.get('zip');
    const city = url.searchParams.get('city');
    const state = url.searchParams.get('state');
    const radius = url.searchParams.get('radius') || '25';

    const apiKey = process.env.ZIPCODE_API_KEY;
    if (!apiKey) return json({ error: 'ZIPCODE_API_KEY not configured' }, 500);

    // If no zip provided but city+state given, look up from our city center ZIP table
    if (!zip && city && state) {
      const cityZips = {
        'houston-tx': '77002', 'dallas-tx': '75201', 'san antonio-tx': '78205',
        'austin-tx': '78701', 'fort worth-tx': '76102', 'miami-fl': '33101',
        'los angeles-ca': '90012', 'chicago-il': '60601', 'new york-ny': '10001',
        'phoenix-az': '85001', 'philadelphia-pa': '19101', 'san diego-ca': '92101',
        'denver-co': '80202', 'seattle-wa': '98101', 'atlanta-ga': '30301',
        'tampa-fl': '33602', 'orlando-fl': '32801', 'nashville-tn': '37201',
        'charlotte-nc': '28202', 'las vegas-nv': '89101', 'jacksonville-fl': '32202',
        'memphis-tn': '38103', 'el paso-tx': '79901', 'oklahoma city-ok': '73102',
        'portland-or': '97201', 'indianapolis-in': '46204', 'columbus-oh': '43215',
        'kansas city-mo': '64105', 'richmond-va': '23219', 'baton rouge-la': '70801',
        'new orleans-la': '70112', 'birmingham-al': '35203', 'raleigh-nc': '27601',
        'salt lake city-ut': '84101', 'minneapolis-mn': '55401', 'detroit-mi': '48226',
        'boston-ma': '02101', 'milwaukee-wi': '53202', 'baltimore-md': '21201',
        'sacramento-ca': '95814', 'st louis-mo': '63101', 'pittsburgh-pa': '15222',
        'cleveland-oh': '44113', 'cincinnati-oh': '45202', 'tucson-az': '85701',
      };

      const key = (city.toLowerCase() + '-' + state.toLowerCase()).trim();
      zip = cityZips[key];

      if (!zip) {
        return json({
          error: 'City not in our lookup table. Please provide a reference ZIP code instead.',
          usage: '/api/zip-lookup?zip=77002&radius=25',
          hint: 'Enter any ZIP code in or near ' + city + ', ' + state + ' and we will find all surrounding ZIPs.'
        }, 400);
      }
    }

    if (!zip) {
      return json({
        error: 'Provide a zip code or city+state',
        usage: {
          by_zip: '/api/zip-lookup?zip=77002&radius=25',
          by_city: '/api/zip-lookup?city=Houston&state=TX',
          note: 'radius is in miles, default 25'
        }
      }, 400);
    }

    // Fetch all ZIPs in radius from zip-codes.com
    const apiUrl = `https://api.zip-codes.com/ZipCodesAPI.svc/1.0/FindZipCodesInRadius?zipcode=${zip}&minimumradius=0&maximumradius=${radius}&key=${apiKey}`;
    const response = await fetch(apiUrl);
    const rawText = (await response.text()).replace(/^\uFEFF/, '').trim();

    let data;
    try { data = JSON.parse(rawText); } catch(e) {
      return json({ error: 'Failed to parse API response', raw: rawText.substring(0, 300) }, 502);
    }

    if (data.Error) {
      return json({ error: data.Error }, 400);
    }

    let zips = [];
    if (data.DataList) {
      zips = data.DataList.map(item => item.Code);
    }

    const prefixes = [...new Set(zips.map(z => z.substring(0, 3)))].sort();

    return json({
      center_zip: zip,
      city: city || null,
      state: state || null,
      radius_miles: parseInt(radius),
      total_zips: zips.length,
      zip_codes: zips,
      prefixes,
      prefix_count: prefixes.length
    });

  } catch (err) {
    return json({ error: 'Internal server error', message: err.message }, 500);
  }
}
