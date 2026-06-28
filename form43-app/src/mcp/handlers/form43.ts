import type { ToolContext, ToolResult } from '../tools';
import { buildPrefillData } from '../../modules/form43/prefill';
import { buildForm43Pdf, bytesToBase64, type Form43PdfData } from '../../modules/form43/pdf';
import { logActivity } from '../../shared/activity';

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export async function handleForm43(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const db = ctx.env.FORM43_DB;

  if (name === 'form43_prefill') {
    const data = buildPrefillData({
      site_address: String(input.site_address ?? ''),
      job_id: input.job_id as string | undefined,
      scope_of_work: input.scope_of_work as string | undefined,
      install_date: input.install_date as string | undefined,
      builder_name: input.builder_name as string | undefined,
      lot_number: input.lot_number as string | undefined,
      purchase_order: input.purchase_order as string | undefined,
      contact_name: input.contact_name as string | undefined,
      contact_phone: input.contact_phone as string | undefined,
    });
    return jsonResult({ success: true, data });
  }

  if (name === 'form43_save') {
    if (input.confirm !== true) {
      return jsonResult({ success: true, pending: true, action: 'form43_save', payload: input, hint: 'Call again with confirm:true to commit.' });
    }
    const result = await db.prepare(
      `INSERT INTO form43_records (
         job_id, street_address, suburb, postcode, lga,
         building_class, building_desc, products_used, areas_waterproofed,
         certifier_ref, da_number, insp_date, cert_date, notes, generated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      (input.job_id as string) ?? null,
      input.street_address as string,
      (input.suburb as string) ?? '',
      (input.postcode as string) ?? '',
      (input.lga as string) ?? '',
      (input.building_class as string) ?? '1a',
      (input.building_desc as string) ?? 'New residential dwelling',
      JSON.stringify(input.products_used ?? []),
      JSON.stringify(input.areas_waterproofed ?? []),
      (input.certifier_ref as string) ?? '',
      (input.da_number as string) ?? '',
      (input.insp_date as string) ?? '',
      (input.cert_date as string) ?? '',
      (input.notes as string) ?? '',
      `mcp:${name}`,
    ).run();
    const id = result.meta.last_row_id as number;
    await logActivity(db, 'FORM43_SAVED', `Form 43 saved via MCP for job ${input.job_id ?? 'none'}`, String(id), ctx.vars.correlationId, ctx.vars.tokenHash);
    return jsonResult({ success: true, data: { id } });
  }

  if (name === 'form43_pdf') {
    const bytes = await buildForm43Pdf(input as Form43PdfData);
    return jsonResult({
      success: true,
      data: { filename: 'form43.pdf', mime: 'application/pdf', base64: bytesToBase64(bytes) },
    });
  }

  if (name === 'form43_list') {
    const limit = Math.min((input.limit as number) ?? 50, 100);
    const { results } = await db.prepare(
      'SELECT id, job_id, street_address, suburb, lga, cert_date, created_at FROM form43_records WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?',
    ).bind(limit).all();
    return jsonResult({ success: true, data: results, count: results?.length ?? 0 });
  }

  if (name === 'form43_get') {
    const id = input.id as number;
    const row = await db.prepare('SELECT * FROM form43_records WHERE id = ? AND is_active = 1').bind(id).first<Record<string, unknown>>();
    if (!row) return jsonResult({ success: false, error: 'Record not found' });
    return jsonResult({
      success: true,
      data: {
        ...row,
        products_used: row.products_used ? JSON.parse(row.products_used as string) : [],
        areas_waterproofed: row.areas_waterproofed ? JSON.parse(row.areas_waterproofed as string) : [],
      },
    });
  }

  if (name === 'form43_delete') {
    if (input.confirm !== true) {
      return jsonResult({ success: true, pending: true, action: 'form43_delete', id: input.id, hint: 'Call again with confirm:true to commit.' });
    }
    const id = input.id as number;
    await db.prepare("UPDATE form43_records SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").bind(id).run();
    await logActivity(db, 'FORM43_DELETED', `Form 43 #${id} deleted via MCP`, String(id), ctx.vars.correlationId, ctx.vars.tokenHash);
    return jsonResult({ success: true, data: { id } });
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown form43 tool: ${name}` }] };
}
