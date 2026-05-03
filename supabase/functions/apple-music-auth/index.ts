// ─── apple-music-auth ─────────────────────────────────────────────────────────
// Serves an HTML page with MusicKit JS that authorizes the user and redirects
// back to the app with the Music User Token.
//
// Why this approach:
//   authorize.music.apple.com/woa uses JavaScript postMessage to return the
//   MUT — it does NOT do a URL redirect. openAuthSessionAsync (ASWebAuth-
//   enticationSession) can only intercept URL redirects, not postMessages.
//   Loading a page WE control, that uses MusicKit JS and then does a real
//   window.location redirect to the app deep link, fixes this.
//
// Flow:
//   1. App calls openAuthSessionAsync(this-url?platform_redirect=hookd://...)
//   2. This function generates a developer token and returns HTML with MusicKit JS
//   3. MusicKit JS calls music.authorize() → iOS shows native auth sheet
//   4. On success, page redirects → hookd://apple-music-callback?music-token=MUT
//   5. ASWebAuthenticationSession intercepts hookd:// and returns to the app
//
// JWT verification is disabled — this serves a public HTML page.

const EXPIRES_IN_SECS = 60 * 60 * 24 * 180; // 6 months

function base64urlEncode(data: Uint8Array): string {
  const bytes = Array.from(data);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateDeveloperToken(): Promise<string> {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID') ?? Deno.env.get('APPLE_MUSIC_KEY_ID');
  const privateKeyPem = Deno.env.get('APPLE_MUSIC_PRIVATE_KEY');

  if (!teamId || !keyId || !privateKeyPem) {
    throw new Error('Missing Apple Music secrets');
  }

  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const header = { alg: 'ES256', kid: keyId };
  const payload = { iss: teamId, iat: now, exp: now + EXPIRES_IN_SECS };

  const headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemBody = privateKeyPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

// ─── HTML page ────────────────────────────────────────────────────────────────

function buildAuthPage(developerToken: string, platformRedirect: string): string {
  // Escape both values for safe embedding — no user-controlled input here,
  // but good practice since platformRedirect comes from the query string.
  const safeToken = developerToken.replace(/[<>"']/g, '');
  const safeRedirect = platformRedirect.replace(/[<>"']/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Apple Music</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
      background: #0a0a0a;
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 24px;
    }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #fc3c44; }
    .subtitle { font-size: 16px; color: rgba(255,255,255,0.6); text-align: center; }
    .status { font-size: 14px; color: rgba(255,255,255,0.4); text-align: center; min-height: 20px; }
    .error { color: #ff4444; }
  </style>
</head>
<body>
  <div class="logo">HOOKD</div>
  <p class="subtitle">Connecting to Apple Music…</p>
  <p class="status" id="status">Loading MusicKit…</p>

  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"></script>
  <script>
    const PLATFORM_REDIRECT = ${JSON.stringify(safeRedirect)};

    function setStatus(msg, isError) {
      const el = document.getElementById('status');
      el.textContent = msg;
      if (isError) el.classList.add('error');
    }

    async function run() {
      try {
        setStatus('Configuring MusicKit…');
        await MusicKit.configure({
          developerToken: ${JSON.stringify(safeToken)},
          app: { name: 'HOOKD', build: '1' },
        });

        setStatus('Requesting authorization…');
        const music = MusicKit.getInstance();
        const musicUserToken = await music.authorize();

        setStatus('Authorized! Returning to app…');
        const dest = PLATFORM_REDIRECT + '?music-token=' + encodeURIComponent(musicUserToken);
        window.location.href = dest;

      } catch (err) {
        console.error('MusicKit auth error:', err);
        setStatus('Error: ' + (err.message || String(err)), true);
        // Redirect back with error so the app can show it
        const dest = PLATFORM_REDIRECT + '?error=' + encodeURIComponent(err.message || 'Authorization failed');
        setTimeout(() => { window.location.href = dest; }, 2000);
      }
    }

    // MusicKit v3 loads async — wait for the script to be ready
    if (window.MusicKit) {
      run();
    } else {
      document.querySelector('script[src*="musickit"]').addEventListener('load', run);
    }
  </script>
</body>
</html>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const platformRedirect = url.searchParams.get('platform_redirect');
  if (!platformRedirect) {
    return new Response('Missing platform_redirect parameter', { status: 400 });
  }

  try {
    const developerToken = await generateDeveloperToken();
    const html = buildAuthPage(developerToken, platformRedirect);
    const headers = new Headers();
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    // Supabase/Cloudflare injects a restrictive CSP on public edge functions.
    // Explicitly set a permissive policy so MusicKit JS can load and run.
    headers.set(
      'Content-Security-Policy',
      "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src *;",
    );
    return new Response(html, { status: 200, headers });
  } catch (err) {
    console.error('[apple-music-auth] Error generating developer token:', err);
    return new Response('Internal error', { status: 500 });
  }
});
