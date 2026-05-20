/**
 * Source-of-truth lives in aqua (src/shared/address-parse.ts).
 * Sync manually if you fix a bug — these two files MUST stay aligned.
 *
 * Australian address parser. Breaks "24/5 Oak Drive, Fortitude Valley QLD 4006"
 * into structured fields. Handles common AU formats deterministically
 * (Lot N, Unit X/Y, slash form, 3-part comma, trailing state+postcode).
 * No network calls — offline-safe.
 */

export interface ParsedAddress {
  lot: string;
  unit: string;
  street1: string;
  suburb: string;
  state: string;
  postcode: string;
}

const STATES = /\b(QLD|NSW|VIC|WA|SA|NT|ACT|TAS)\b/i;
const POSTCODE_AT_END = /(\d{4})\s*$/;

export function parseAustralianAddress(raw: string): ParsedAddress {
  const out: ParsedAddress = { lot: '', unit: '', street1: '', suburb: '', state: 'QLD', postcode: '' };
  if (!raw || typeof raw !== 'string') return out;

  let work = raw
    .replace(/\blot\s+(\w+)\s*\((\d+)\)\s*/i, 'Lot $1, $2 ')
    .trim();

  const parts = work.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return out;

  const firstLotOnly = parts[0].match(/^lot\s+([\w/-]+)$/i);
  if (firstLotOnly) {
    out.lot = firstLotOnly[1];
    parts.shift();
  }

  if (parts.length >= 2) {
    const last = parts.pop() as string;

    const pcMatch = last.match(POSTCODE_AT_END);
    if (pcMatch) out.postcode = pcMatch[1];

    const stateMatch = last.match(STATES);
    if (stateMatch) out.state = stateMatch[1].toUpperCase();

    let suburb = last.replace(POSTCODE_AT_END, '').replace(STATES, '').trim();
    if (!suburb && parts.length > 0) suburb = parts.pop() as string;
    out.suburb = suburb;
  } else {
    const only = parts.pop() as string;
    const pcMatch = only.match(POSTCODE_AT_END);
    if (pcMatch) out.postcode = pcMatch[1];
    const stateMatch = only.match(STATES);
    if (stateMatch) out.state = stateMatch[1].toUpperCase();
    const stripped = only.replace(POSTCODE_AT_END, '').replace(STATES, '').trim();
    parts.push(stripped);
  }

  let street = parts.join(', ').trim();

  const slashForm = street.match(/^(?:(?:unit|u|apt|apartment)\s*)?([\w-]+)\/(\d+[^,]*)$/i);
  if (slashForm && /^\d/.test(slashForm[2])) {
    out.unit = slashForm[1];
    street = slashForm[2].trim();
  } else {
    const wordForm = street.match(/^(?:unit|apt|apartment)\s+([\w-]+)[\s,]+(.+)$/i);
    if (wordForm) {
      out.unit = wordForm[1];
      street = wordForm[2].trim();
    }
  }

  if (!out.lot) {
    street = street.replace(/^lot\s+(?=\d)/i, '').trim();
  }

  out.street1 = street;
  return out;
}
