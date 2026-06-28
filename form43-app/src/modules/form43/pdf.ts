/**
 * Server-side Form 43 certificate PDF renderer.
 *
 * Pure pdf-lib — runs in both the Cloudflare Worker and the local Node
 * build (no native deps, no headless browser). Produces a clean A4
 * QLD Form 43 "Certificate of Compliance for Waterproofing".
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface Form43PdfData {
  job_id?: string;
  builder_name?: string;
  street_address?: string;
  suburb?: string;
  postcode?: string;
  state?: string;
  lga?: string;
  lot?: string;
  unit?: string;
  building_class?: string;
  building_desc?: string;
  products_used?: string[];
  areas_waterproofed?: string[];
  certifier_ref?: string;
  da_number?: string;
  insp_date?: string;
  cert_date?: string;
  contact_name?: string;
  contact_phone?: string;
  notes?: string;
}

const NAVY = rgb(0.10, 0.23, 0.36);
const ACCENT = rgb(0.91, 0.45, 0.04);
const TEXT = rgb(0.10, 0.10, 0.18);
const MUTED = rgb(0.42, 0.45, 0.50);
const LINE = rgb(0.82, 0.84, 0.86);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

export async function buildForm43Pdf(data: Form43PdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('QLD Form 43 — Certificate of Compliance for Waterproofing');
  doc.setProducer('form43-app');
  doc.setCreator('Driven Waterproofing Solutions');

  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  // ── Header band ───────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: NAVY });
  page.drawRectangle({ x: MARGIN, y: height - 70, width: 46, height: 26, color: ACCENT });
  page.drawText('DWP', { x: MARGIN + 7, y: height - 64, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Form 43', { x: MARGIN + 60, y: height - 56, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Certificate of Compliance for Waterproofing (QLD)', {
    x: MARGIN + 60, y: height - 74, size: 9.5, font, color: rgb(0.82, 0.86, 0.9),
  });
  page.drawText('Driven Waterproofing Solutions Pty Ltd', {
    x: width - MARGIN - 220, y: height - 56, size: 9, font, color: rgb(0.82, 0.86, 0.9),
  });

  let y = height - 128;

  // ── Compliance statement ──────────────────────────────────
  const statement =
    'This certifies that the waterproofing of the wet areas described below has been ' +
    'carried out in accordance with the National Construction Code (NCC) and AS 3740, ' +
    'using the products and to the areas listed.';
  y = drawWrapped(page, statement, MARGIN, y, width - MARGIN * 2, font, 10, TEXT, 14);
  y -= 14;

  // ── Site / job section ────────────────────────────────────
  y = sectionTitle(page, 'Site & Job', MARGIN, y, bold);
  const addressLine = [
    data.unit ? `Unit ${data.unit}` : '',
    data.lot ? `Lot ${data.lot}` : '',
    data.street_address || '',
  ].filter(Boolean).join(', ');
  const cityLine = [data.suburb, data.state, data.postcode].filter(Boolean).join(' ');

  y = row(page, 'Builder', data.builder_name, MARGIN, y, font, bold);
  y = row(page, 'Job reference', data.job_id, MARGIN, y, font, bold);
  y = row(page, 'Site address', addressLine, MARGIN, y, font, bold);
  y = row(page, 'Suburb / State / PC', cityLine, MARGIN, y, font, bold);
  y = row(page, 'Local Government Area', data.lga, MARGIN, y, font, bold);
  y -= 10;

  // ── Building section ──────────────────────────────────────
  y = sectionTitle(page, 'Building', MARGIN, y, bold);
  y = row(page, 'Building class', data.building_class || '1a', MARGIN, y, font, bold);
  y = row(page, 'Description', data.building_desc || 'New residential dwelling', MARGIN, y, font, bold);
  y -= 10;

  // ── Waterproofing section ─────────────────────────────────
  y = sectionTitle(page, 'Waterproofing', MARGIN, y, bold);
  y = row(page, 'Areas waterproofed', (data.areas_waterproofed || []).join(', '), MARGIN, y, font, bold);
  y = row(page, 'Products / membranes', (data.products_used || []).join(', '), MARGIN, y, font, bold);
  y -= 10;

  // ── Certification section ─────────────────────────────────
  y = sectionTitle(page, 'Certification', MARGIN, y, bold);
  y = row(page, 'Certifier reference', data.certifier_ref, MARGIN, y, font, bold);
  y = row(page, 'DA / approval number', data.da_number, MARGIN, y, font, bold);
  y = row(page, 'Inspection date', data.insp_date, MARGIN, y, font, bold);
  y = row(page, 'Certificate date', data.cert_date, MARGIN, y, font, bold);
  if (data.notes) {
    y -= 4;
    y = row(page, 'Notes', data.notes, MARGIN, y, font, bold);
  }

  // ── Signature block ───────────────────────────────────────
  const sigY = 130;
  page.drawLine({ start: { x: MARGIN, y: sigY }, end: { x: MARGIN + 200, y: sigY }, thickness: 0.8, color: LINE });
  page.drawLine({ start: { x: width - MARGIN - 200, y: sigY }, end: { x: width - MARGIN, y: sigY }, thickness: 0.8, color: LINE });
  page.drawText('Authorised signature', { x: MARGIN, y: sigY - 14, size: 8.5, font, color: MUTED });
  page.drawText('Date', { x: width - MARGIN - 200, y: sigY - 14, size: 8.5, font, color: MUTED });
  if (data.contact_name) {
    page.drawText(data.contact_name, { x: MARGIN, y: sigY + 6, size: 10, font: bold, color: TEXT });
  }
  if (data.cert_date) {
    page.drawText(data.cert_date, { x: width - MARGIN - 200, y: sigY + 6, size: 10, font: bold, color: TEXT });
  }

  // ── Footer ────────────────────────────────────────────────
  page.drawText('Generated by form43-app — review before issuing.', {
    x: MARGIN, y: 40, size: 8, font, color: MUTED,
  });

  return doc.save();
}

/** Chunk-safe Uint8Array -> base64 (avoids spread stack overflow). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── helpers ─────────────────────────────────────────────────

function sectionTitle(page: PDFPage, label: string, x: number, y: number, bold: PDFFont): number {
  page.drawText(label.toUpperCase(), { x, y, size: 9, font: bold, color: ACCENT });
  page.drawLine({ start: { x, y: y - 5 }, end: { x: page.getWidth() - MARGIN, y: y - 5 }, thickness: 0.6, color: LINE });
  return y - 22;
}

function row(page: PDFPage, label: string, value: string | undefined, x: number, y: number, font: PDFFont, bold: PDFFont): number {
  page.drawText(label, { x, y, size: 9, font, color: MUTED });
  const v = (value && value.trim()) ? value : '—';
  const valX = x + 150;
  const maxW = page.getWidth() - MARGIN - valX;
  const endY = drawWrapped(page, v, valX, y, maxW, bold, 10, TEXT, 13);
  return Math.min(y, endY) - 18;
}

function drawWrapped(
  page: PDFPage, text: string, x: number, y: number, maxWidth: number,
  font: PDFFont, size: number, color: ReturnType<typeof rgb>, lineHeight: number,
): number {
  const words = text.split(/\s+/);
  let line = '';
  let cursorY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      page.drawText(line, { x, y: cursorY, size, font, color });
      cursorY -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x, y: cursorY, size, font, color });
  return cursorY;
}
