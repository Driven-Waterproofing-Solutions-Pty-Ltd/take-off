/**
 * ═══════════════════════════════════════════════════════════
 * Form 43 — QLD Certificate of Compliance for Waterproofing
 * ═══════════════════════════════════════════════════════════
 * Endpoints (all under /api/v1/form43):
 *   POST   /prefill         — build a prefill payload from a job snapshot
 *   POST   /save            — persist a completed certificate
 *   GET    /history         — list saved certificates (active only)
 *   GET    /history/:id     — get one
 *   DELETE /history/:id     — soft-delete (is_active = 0)
 *
 * Ported from aqua/src/modules/form43/routes.ts. The aqua-specific
 * `jobs` join is replaced by /prefill which accepts a payload directly.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppType } from '../../shared/types';
import { logActivity } from '../../shared/activity';
import { ok, err } from '../../shared/response';
import prefillRouter from './prefill';
import { buildForm43Pdf, bytesToBase64, type Form43PdfData } from './pdf';

const router = new Hono<AppType>();

router.route('/', prefillRouter);

const SaveInput = z.object({
  confirm: z.boolean().optional(),
  job_id: z.string().optional(),
  street_address: z.string().min(1),
  suburb: z.string().optional(),
  postcode: z.string().optional(),
  lga: z.string().optional(),
  building_class: z.string().optional(),
  building_desc: z.string().optional(),
  products_used: z.array(z.string()).default([]),
  areas_waterproofed: z.array(z.string()).default([]),
  certifier_ref: z.string().optional(),
  da_number: z.string().optional(),
  insp_date: z.string().optional(),
  cert_date: z.string().optional(),
  notes: z.string().optional(),
  generated_by: z.string().optional(),
});

router.post('/save', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json(err('Invalid JSON'), 400); }
  const parsed = SaveInput.safeParse(body);
  if (!parsed.success) return c.json(err(`Invalid input: ${parsed.error.message}`), 400);
  const input = parsed.data;

  // HR-12 spirit: two-turn confirm for state-changing actions when called via MCP.
  // HTTP direct callers can opt in by passing confirm:true; otherwise we still
  // accept the write (consistent with aqua's current /save endpoint behaviour).
  if (input.confirm === false) {
    return c.json(ok({ pending: true, action: 'form43_save', payload: input }, { message: 'Call again with confirm:true to commit' }));
  }

  try {
    const result = await c.env.FORM43_DB.prepare(
      `INSERT INTO form43_records (
         job_id, street_address, suburb, postcode, lga,
         building_class, building_desc, products_used, areas_waterproofed,
         certifier_ref, da_number, insp_date, cert_date, notes, generated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.job_id ?? null,
      input.street_address,
      input.suburb ?? '',
      input.postcode ?? '',
      input.lga ?? '',
      input.building_class ?? '1a',
      input.building_desc ?? 'New residential dwelling',
      JSON.stringify(input.products_used),
      JSON.stringify(input.areas_waterproofed),
      input.certifier_ref ?? '',
      input.da_number ?? '',
      input.insp_date ?? '',
      input.cert_date ?? '',
      input.notes ?? '',
      input.generated_by ?? 'manual',
    ).run();

    const id = result.meta.last_row_id as number;
    await logActivity(
      c.env.FORM43_DB,
      'FORM43_SAVED',
      `Form 43 saved for job ${input.job_id ?? 'none'} at ${input.street_address}`,
      String(id),
      c.get('correlationId'),
      c.get('tokenHash'),
    );
    return c.json(ok({ id }, { message: 'Form 43 record saved' }), 201);
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 500);
  }
});

// POST /pdf — render a Form 43 certificate PDF from a payload.
// Returns application/pdf by default, or { base64 } JSON when ?format=base64
// (the MCP form43_pdf tool uses base64 so an agent can receive the bytes).
router.post('/pdf', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json(err('Invalid JSON'), 400); }
  const data = body as Form43PdfData;
  if (!data || (!data.street_address && !data.job_id)) {
    return c.json(err('Provide at least street_address or job_id'), 400);
  }

  try {
    const bytes = await buildForm43Pdf(data);
    if (c.req.query('format') === 'base64') {
      return c.json(ok({ filename: 'form43.pdf', mime: 'application/pdf', base64: bytesToBase64(bytes) }));
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="form43.pdf"',
      },
    });
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 500);
  }
});

router.get('/history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 100);
  try {
    const { results } = await c.env.FORM43_DB.prepare(
      'SELECT * FROM form43_records WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?',
    ).bind(limit).all();

    const data = (results || []).map((r: Record<string, unknown>) => ({
      ...r,
      products_used: r.products_used ? JSON.parse(r.products_used as string) : [],
      areas_waterproofed: r.areas_waterproofed ? JSON.parse(r.areas_waterproofed as string) : [],
    }));

    return c.json(ok(data, { count: data.length }));
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 500);
  }
});

router.get('/history/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json(err('Invalid id'), 400);

  try {
    const row = await c.env.FORM43_DB.prepare(
      'SELECT * FROM form43_records WHERE id = ? AND is_active = 1',
    ).bind(id).first<Record<string, unknown>>();
    if (!row) return c.json(err('Record not found'), 404);

    return c.json(ok({
      ...row,
      products_used: row.products_used ? JSON.parse(row.products_used as string) : [],
      areas_waterproofed: row.areas_waterproofed ? JSON.parse(row.areas_waterproofed as string) : [],
    }));
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 500);
  }
});

router.delete('/history/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json(err('Invalid id'), 400);

  try {
    await c.env.FORM43_DB.prepare(
      "UPDATE form43_records SET is_active = 0, deleted_at = datetime('now') WHERE id = ?",
    ).bind(id).run();
    await logActivity(
      c.env.FORM43_DB,
      'FORM43_DELETED',
      `Form 43 #${id} deleted`,
      String(id),
      c.get('correlationId'),
      c.get('tokenHash'),
    );
    return c.json(ok({ id }, { message: 'Record deleted' }));
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 500);
  }
});

export default router;
