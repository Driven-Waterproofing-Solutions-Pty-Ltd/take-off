// PBKDF2-SHA256 password hashing via Web Crypto.
// 600k iterations matches OWASP 2023 minimum for SHA-256.
// 16-byte salt, 32-byte derived key, both base64-encoded for D1 storage.

const ITERATIONS = 600_000;
const KEY_LEN_BYTES = 32;
const SALT_LEN_BYTES = 16;

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    baseKey,
    KEY_LEN_BYTES * 8
  );
  return new Uint8Array(bits);
}

export interface HashedPassword {
  hash: string; // base64
  salt: string; // base64
  iterations: number;
}

export async function hashPassword(plaintext: string): Promise<HashedPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN_BYTES));
  const derived = await pbkdf2(plaintext, salt, ITERATIONS);
  return {
    hash: bytesToBase64(derived),
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
  };
}

export async function verifyPassword(
  plaintext: string,
  storedHash: string,
  storedSalt: string,
  iterations: number
): Promise<boolean> {
  const salt = base64ToBytes(storedSalt);
  const expected = base64ToBytes(storedHash);
  const derived = await pbkdf2(plaintext, salt, iterations);

  // Constant-time compare: never short-circuit on first mismatch, so the
  // verification time leaks no information about the stored hash.
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}
