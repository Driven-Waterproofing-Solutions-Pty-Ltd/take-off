import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { hashPassword, verifyPassword } from '../lib/passwords';
import {
  createSession,
  deleteSession,
  readSession,
  clearSessionCookie,
  COOKIE_NAME,
} from '../lib/sessions';
import { requireAuth } from '../lib/auth';

const app = new Hono<{ Bindings: Env }>();

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iter: number;
  name: string | null;
  role: 'admin' | 'member';
  created_at: number;
  last_login_at: number | null;
}

const LoginZ = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
});

app.post('/login', async (c) => {
  const body = LoginZ.parse(await c.req.json());

  // Always run the hash even when the user doesn't exist, to avoid leaking
  // existence via response time. Cheap defense; the real anti-enumeration
  // gate is rate limiting at the edge (Cloudflare WAF rule, future).
  const row = (await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  )
    .bind(body.email)
    .first()) as UserRow | null;

  const fakeSalt = 'AAAAAAAAAAAAAAAAAAAAAA=='; // 16 zero bytes b64
  const fakeHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes b64
  const ok = await verifyPassword(
    body.password,
    row?.password_hash ?? fakeHash,
    row?.password_salt ?? fakeSalt,
    row?.password_iter ?? 600_000
  );

  if (!row || !ok) {
    return c.json({ error: 'invalid credentials' }, 401);
  }

  // Rotate session on login: nothing prior to delete on first-time use,
  // but if someone hijacks an old cookie and the legit user logs in fresh,
  // the old session is left orphaned (revoke via /admin/sessions later).
  const { cookie } = await createSession(c.env, {
    userId: row.id,
    userAgent: c.req.header('User-Agent') ?? undefined,
    ip: c.req.header('CF-Connecting-IP') ?? undefined,
  });

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(Date.now(), row.id)
    .run();

  c.header('Set-Cookie', cookie);
  return c.json({
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
  });
});

app.post('/logout', async (c) => {
  const session = await readSession(c.env, c.req.header('Cookie'));
  if (session) await deleteSession(c.env, session.sessionId);
  c.header('Set-Cookie', clearSessionCookie());
  return c.json({ ok: true });
});

app.get('/me', requireAuth, async (c) => {
  // Authenticated via cookie, MCP bearer, or Cf-Access — return what we know.
  const auth = c.get('auth');
  if (auth.via === 'session') {
    const row = (await c.env.DB.prepare(
      'SELECT id, email, name, role FROM users WHERE id = ?'
    )
      .bind(auth.identity)
      .first()) as Pick<UserRow, 'id' | 'email' | 'name' | 'role'> | null;
    if (!row) return c.json({ error: 'user not found' }, 404);
    return c.json({ user: row, via: 'session' });
  }
  return c.json({ identity: auth.identity, via: auth.via });
});

export default app;

// ---------- /admin/users (mounted separately) ----------

export const adminApp = new Hono<{ Bindings: Env }>();

function requireBootstrap(c: { env: Env; req: { header: (n: string) => string | undefined } }) {
  const h = c.req.header('Authorization');
  if (!h || !h.startsWith('Bearer ')) return false;
  return !!c.env.MCP_BOOTSTRAP_TOKEN && h.slice('Bearer '.length) === c.env.MCP_BOOTSTRAP_TOKEN;
}

const CreateUserZ = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.enum(['admin', 'member']).optional().default('member'),
});

adminApp.post('/', async (c) => {
  if (!requireBootstrap(c)) return c.json({ error: 'forbidden' }, 403);

  const body = CreateUserZ.parse(await c.req.json());
  const id = crypto.randomUUID();
  const pw = await hashPassword(body.password);
  try {
    await c.env.DB.prepare(
      `INSERT INTO users
         (id, email, password_hash, password_salt, password_iter, name, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, body.email, pw.hash, pw.salt, pw.iterations, body.name ?? null, body.role, Date.now())
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE/.test(msg)) return c.json({ error: 'email already exists' }, 409);
    throw e;
  }
  return c.json({ id, email: body.email, name: body.name ?? null, role: body.role });
});

adminApp.get('/', async (c) => {
  if (!requireBootstrap(c)) return c.json({ error: 'forbidden' }, 403);
  const rows = (
    await c.env.DB.prepare(
      'SELECT id, email, name, role, created_at, last_login_at FROM users ORDER BY created_at DESC'
    ).all()
  ).results;
  return c.json(rows);
});
