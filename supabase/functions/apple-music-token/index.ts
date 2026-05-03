// ─── apple-music-token ────────────────────────────────────────────────────────
// Supabase Edge Function: generates a signed Apple Music developer JWT.
//
// The private key must never touch the client. This function signs a short-lived
// (6-month max) ES256 JWT using the MusicKit private key stored as a secret.
//
// Secrets required (set via `supabase secrets set`):
//   APPLE_TEAM_ID           — 10-character Apple Developer Team ID
//   APPLE_MUSIC_KEY_ID      — Key ID from the MusicKit key (Music IDs section)
//   APPLE_MUSIC_PRIVATE_KEY — Full PEM text of the .p8 private key, including headers

const EXPIRES_IN_SECS = 60 * 60 * 24 * 180; // 6 months (Apple's documented max)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, Authorization',
};

// ─── JWT Generation ───────────────────────────────────────────────────────────

function base64urlEncode(data: Uint8Array): string {
  const bytes = Array.from(data);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateDeveloperToken(): Promise<string> {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  // Secret was stored as APPLE_KEY_ID — fall back to APPLE_MUSIC_KEY_ID for compatibility
  const keyId = Deno.env.get('APPLE_KEY_ID') ?? Deno.env.get('APPLE_MUSIC_KEY_ID');
  const privateKeyPem = Deno.env.get('APPLE_MUSIC_PRIVATE_KEY');

  const missing = [
    !teamId && 'APPLE_TEAM_ID',
    !keyId && 'APPLE_KEY_ID',
    !privateKeyPem && 'APPLE_MUSIC_PRIVATE_KEY',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const header = { alg: 'ES256', kid: keyId };
  const payload = { iss: teamId, iat: now, exp: now + EXPIRES_IN_SECS };

  const headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Strip PEM armor and decode the PKCS#8 DER bytes
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

  const signatureB64 = base64urlEncode(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = await generateDeveloperToken();
    return new Response(
      JSON.stringify({ token, expiresIn: EXPIRES_IN_SECS }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[apple-music-token] Error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to generate token' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
