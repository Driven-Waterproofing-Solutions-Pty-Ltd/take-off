// AES-GCM helpers for at-rest secrets (Xero tokens).
// The key is derived from XERO_TOKEN_KEY (rotate by re-encrypting).

async function deriveKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, usage);
}

export async function encryptString(secret: string, plaintext: string): Promise<string> {
  const key = await deriveKey(secret, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  );
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(ct, iv.byteLength);
  let s = '';
  for (const b of combined) s += String.fromCharCode(b);
  return `v1:${btoa(s)}`;
}

export async function decryptString(secret: string, value: string): Promise<string> {
  if (!value.startsWith('v1:')) {
    // Allow reading legacy plaintext rows once during migration.
    return value;
  }
  const combined = Uint8Array.from(atob(value.slice(3)), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const key = await deriveKey(secret, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const STATE_TTL_MS = 10 * 60 * 1000;

export async function signOauthState(secret: string, state: string): Promise<string> {
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload = `${state}.${expiresAt}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyOauthState(secret: string, signed: string, state: string): Promise<boolean> {
  const parts = signed.split('.');
  if (parts.length !== 3) return false;
  const [s, expStr, sig] = parts;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  if (s !== state) return false;
  const expected = await hmac(secret, `${s}.${expiresAt}`);
  return timingSafeEqual(expected, sig);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
