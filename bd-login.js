export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ success: false, error: 'Email and password are required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // POST to BD's login endpoint server-side (no CORS)
    const formBody = new URLSearchParams();
    formBody.append('email', email);
    formBody.append('password', password);

    const bdResponse = await fetch('https://contractors.selectservicepros.com/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: formBody.toString(),
      redirect: 'manual', // Don't follow redirects — we want to inspect them
    });

    // BD behavior on success: redirects to /account (302/303)
    // BD behavior on failure: stays on /login (200) or redirects back to /login
    const status = bdResponse.status;
    const location = bdResponse.headers.get('location') || '';
    const setCookie = bdResponse.headers.get('set-cookie') || '';

    // Check for successful login indicators
    if (status === 301 || status === 302 || status === 303 || status === 307) {
      // Redirect happened — check where it's going
      if (location.includes('/account') || location.includes('/dashboard') || location.includes('/member')) {
        // Success — BD is redirecting to the member area
        return new Response(JSON.stringify({
          success: true,
          redirect: location.startsWith('http') ? location : 'https://contractors.selectservicepros.com' + location,
          cookies: setCookie,
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } else if (location.includes('/login')) {
        // Redirected back to login — credentials were wrong
        return new Response(JSON.stringify({ success: false, error: 'Incorrect email or password.' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // If we got a 200 back, read the body to check for error messages
    if (status === 200) {
      const body = await bdResponse.text();
      const bodyLower = body.toLowerCase();

      // Check if the response contains the member dashboard/account content
      if (bodyLower.includes('my account') || bodyLower.includes('member dashboard') || bodyLower.includes('account settings')) {
        return new Response(JSON.stringify({
          success: true,
          redirect: 'https://contractors.selectservicepros.com/account',
          cookies: setCookie,
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Otherwise it's the login page again — credentials failed
      return new Response(JSON.stringify({ success: false, error: 'Incorrect email or password.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Any other status — generic failure
    return new Response(JSON.stringify({ success: false, error: 'Incorrect email or password.' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Unable to connect. Please try again.',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
