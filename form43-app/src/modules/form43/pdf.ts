/**
 * Server-side Form 43 PDF — fills the OFFICIAL QLD Government / QBCC
 * Form 43 template (Certificate of Compliance for Waterproofing).
 *
 * This is the SAME official fillable PDF the /form43 browser page uses
 * (QBCC AcroForm). We load it, set the official field names (FM), flatten,
 * and return — so the server output is the real Form 43, not a redrawn
 * lookalike. Field names + licensee defaults + scope/basis/refdocs text
 * are kept verbatim-aligned with standalone.ts's getVals().
 *
 * Pure pdf-lib — runs in both the Worker and the local Node build.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { QBCC_FORM43_TEMPLATE_B64 } from './qbcc-template';

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
  refdocs?: string;
  /**
   * When set, draws this name on the page-3 "Signature of QBCC licensee"
   * line (the licensee's signature). For Driven this is "Andrew Brett Driver".
   * Leave unset to produce an unsigned certificate.
   */
  signatory?: string;
  /** Optional signing date (DD/MM/YYYY or YYYY-MM-DD); defaults to cert_date. */
  signature_date?: string;
}

// Official QBCC AcroForm field names (verbatim from standalone.ts FM map).
const FM = {
  scope: 'Scope of the aspect work',
  street1: 'Street address 1', street2: 'Street address 2',
  state1: 'State 1', postcode1: 'Postcode 1',
  lot: 'Lot and plan details 1', lga: 'Local government area 1',
  bdesc: 'Building/structure description', bclass: 'Class of building/structure 1',
  description: 'Description of aspect/s certified',
  basis: 'Basis of certification', refdocs: 'Reference documentation',
  certref: 'Building certifier reference number', danum: 'Development approval number',
  name: 'Name 1', company: 'Company name 1', contact: 'Contact person 1',
  bizphone: 'Business phone number 1', mobile: 'Mobile number 1',
  email: 'Email address 1', addr1: 'Postal address 1', addr2: 'Postal address 2',
  state2: 'State 2', postcode2: 'Postcode 2',
  licclass: 'Licence class', licnum: 'Licence number',
  inspdate: 'Date approval to inspect received from building certifier',
  certdate: 'Date 9',
} as const;

// QBCC licensee details — pre-filled in the page, fixed for Driven WP.
const LICENSEE = {
  name: 'Andrew Brett Driver',
  company: 'Driven Waterproofing Solutions PTY LTD',
  bizphone: '0473 518 216',
  mobile: '0473 518 216',
  email: 'office@drivenwp.com',
  addr1: '2 Dijon Ct',
  addr2: 'Petrie',
  state2: 'QLD',
  postcode2: '4502',
  licclass: 'Waterproofing',
  licnum: '15214278',
} as const;

const SCOPE =
  'Installing waterproofing materials to all wet areas such as bathrooms, ensuites, toilets, ' +
  'laundries, balconies, decks, retaining walls, rooftops, planter boxes and basements in ' +
  'accordance with the Building Code of Australia — AS 3740:2021 (Waterproofing of domestic wet ' +
  'areas) and AS 4654.2-2012 (Waterproofing membranes for external above-ground use) and ' +
  'AS 4654.1-2012 and NCC Volume 2 Part 10.2';

const BASIS =
  'Installation of waterproofing membranes carried out in accordance with AS 3740:2021, ' +
  'AS 4654.2-2012 and AS 4654.1-2012 and NCC Volume 2 Part 10.2, QBCC licence conditions ' +
  "(Licence No. 15214278), and manufacturer's installation requirements. All works inspected " +
  'and certified by QBCC licensed waterproofing contractor.';

const DEFAULT_REFDOCS =
  'Development permit documents including Decision Notice, stamped approved plans and reports. ' +
  'Waterproofing installed in accordance with QBCC licence requirements (Licence No. 15214278). ' +
  'Product data sheets and manufacturer installation guides for all products used. Full breakdown ' +
  'of materials and areas available upon request.';

function fmtDate(d: string | undefined): string {
  if (!d) return '';
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`; // YYYY-MM-DD -> DD/MM/YYYY
  return d;
}

// Build the "Description of aspect/s certified" block exactly like the page.
function buildDescription(data: Form43PdfData): string {
  const parts: string[] = [];
  const prods = data.products_used ?? [];
  const areas = data.areas_waterproofed ?? [];
  if (prods.length) parts.push('Products used: ' + prods.join(', '));
  if (areas.length) parts.push('Areas waterproofed: ' + areas.join(', '));
  parts.push('All waterproofing installed by QBCC licensed contractor — Licence No. 15214278');
  parts.push('Installed in accordance with AS 3740:2021, AS 4654.2-2012 and AS 4654.1-2012 and NCC Volume 2 Part 10.2');
  return parts.join('\n');
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function buildForm43Pdf(data: Form43PdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base64ToBytes(QBCC_FORM43_TEMPLATE_B64), { ignoreEncryption: true });
  const form = doc.getForm();

  const lot = [data.unit ? `Unit ${data.unit}` : '', data.lot ? `Lot ${data.lot}` : '']
    .filter(Boolean).join(', ') || (data.lot ?? '');

  // Text fields (skip empties so the official template's own blanks remain blank).
  const textFields: Record<string, string | undefined> = {
    [FM.scope]: SCOPE,
    [FM.street1]: data.street_address,
    [FM.street2]: data.suburb,
    [FM.postcode1]: data.postcode,
    [FM.lot]: lot,
    [FM.lga]: data.lga,
    [FM.bdesc]: data.building_desc || 'New residential dwelling',
    [FM.bclass]: data.building_class || '1a',
    [FM.description]: buildDescription(data),
    [FM.basis]: BASIS,
    [FM.refdocs]: data.refdocs || DEFAULT_REFDOCS,
    // certref / inspdate belong to the EXTERNAL building certifier (who relies
    // on this aspect certificate). The licensee block below is Driven — the
    // competent person certifying its own waterproofing aspect, NOT the certifier.
    [FM.certref]: data.certifier_ref,
    [FM.danum]: data.da_number,
    [FM.name]: LICENSEE.name,
    [FM.company]: LICENSEE.company,
    [FM.contact]: data.contact_name || LICENSEE.name,
    [FM.bizphone]: data.contact_phone || LICENSEE.bizphone,
    [FM.mobile]: LICENSEE.mobile,
    [FM.email]: LICENSEE.email,
    [FM.addr1]: LICENSEE.addr1,
    [FM.addr2]: LICENSEE.addr2,
    [FM.postcode2]: LICENSEE.postcode2,
    [FM.licclass]: LICENSEE.licclass,
    [FM.licnum]: LICENSEE.licnum,
    [FM.inspdate]: fmtDate(data.insp_date),
    // Page-3 Date sits beside the signature line; use the signing date when given.
    [FM.certdate]: fmtDate(data.signature_date || data.cert_date),
  };

  for (const [fname, fval] of Object.entries(textFields)) {
    if (!fval) continue;
    try {
      const field = form.getField(fname);
      const kind = field.constructor.name;
      if (kind === 'PDFDropdown' || kind === 'PDFOptionList') {
        try { (field as any).select(fval); } catch { try { (field as any).setText(fval); } catch { /* noop */ } }
      } else {
        (field as any).setText(String(fval));
      }
    } catch { /* field absent in template — skip, like the page does */ }
  }

  // State dropdowns (select with graceful fallback).
  try { form.getDropdown(FM.state1).select(data.state || 'QLD'); } catch { /* noop */ }
  try { form.getDropdown(FM.state2).select(LICENSEE.state2); } catch { /* noop */ }

  form.flatten();

  // Signature — the official template has no AcroForm signature field; the
  // page-3 "9. Signature of QBCC licensee" line is a drawn underline. When a
  // signatory is supplied, draw the name on that line (italic, like a signature).
  if (data.signatory) {
    const sigFont = await doc.embedFont(StandardFonts.TimesRomanItalic);
    const page3 = doc.getPages()[2];
    if (page3) {
      page3.drawText(data.signatory, {
        x: 226,
        y: 772,
        size: 15,
        font: sigFont,
        color: rgb(0.05, 0.05, 0.22),
      });
    }
  }

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
