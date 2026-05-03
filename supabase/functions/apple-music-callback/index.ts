// ─── apple-music-callback ────────────────────────────────────────────────────
// HTTPS redirect proxy for Apple Music OAuth.
//
// Problem: authorize.music.apple.com/woa only accepts an HTTPS redirect URI.
// Using a custom scheme (hookd:// or exp://) directly as the `p` parameter
// causes Apple's auth page to show "There may be a network issue."
//
// Solution: use this function as the `p` parameter (HTTPS ✓). Apple redirects
// here with the Music User Token, then we 302 to the app's actual deep link.
//
// Flow:
//   1. App opens woa?...&p=https://this-function?platform_redirect=hookd://...
//   2. User authorizes in browser
//   3. Apple redirects → https://this-function?platform_redirect=hookd://...&music-token=MUT
//   4. This function 302s → hookd://apple-music-callback?music-token=MUT
//   5. openAuthSessionAsync catches hookd:// and returns { type: 'success', url }
//
// JWT verification is disabled — this endpoint is called by Apple's servers,
// not by the app, so there's no Supabase auth token in the request.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const platformRedirect = url.searchParams.get('platform_redirect');

  if (!platformRedirect) {
    console.error('[apple-music-callback] Missing platform_redirect param');
    return new Response('Missing platform_redirect parameter', { status: 400 });
  }

  // Forward all params Apple added (music-token, mut, etc.) onto the app URI.
  // Remove platform_redirect itself before forwarding.
  const appUrl = new URL(platformRedirect);
  url.searchParams.forEach((value, key) => {
    if (key !== 'platform_redirect') {
      appUrl.searchParams.set(key, value);
    }
  });

  const destination = appUrl.toString();
  console.log('[apple-music-callback] Redirecting to', destination.slice(0, 80));

  return new Response(null, {
    status: 302,
    headers: {
      ...CORS_HEADERS,
      Location: destination,
    },
  });
});
