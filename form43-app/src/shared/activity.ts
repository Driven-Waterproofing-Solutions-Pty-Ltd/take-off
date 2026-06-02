export async function logActivity(
  db: D1Database,
  eventType: string,
  description: string,
  resourceId?: string,
  correlationId?: string,
  tokenHash?: string,
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO activity_log (event_type, description, resource_id, correlation_id, token_hash) VALUES (?, ?, ?, ?, ?)',
    ).bind(eventType, description, resourceId ?? null, correlationId ?? null, tokenHash ?? null).run();
  } catch {
    // Activity logging must never break the request path.
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
