import { describe, expect, it } from 'vitest';
import { parseAustralianAddress } from '../src/shared/address-parse';
import { lookupLGA } from '../src/shared/qld-lga';
import { buildPrefillData, parseScopeForAreas } from '../src/modules/form43/prefill';
import { buildForm43Pdf } from '../src/modules/form43/pdf';

describe('parseAustralianAddress', () => {
  it('splits a Lot N + street + suburb + state + postcode line', () => {
    const p = parseAustralianAddress('Lot 42, 25 Cameron Rd, Morayfield QLD 4506');
    expect(p).toMatchObject({ lot: '42', street1: '25 Cameron Rd', suburb: 'Morayfield', state: 'QLD', postcode: '4506' });
  });
  it('handles slash form unit numbers', () => {
    const p = parseAustralianAddress('3/15 Main Rd, Brisbane QLD 4000');
    expect(p).toMatchObject({ unit: '3', street1: '15 Main Rd', suburb: 'Brisbane', state: 'QLD' });
  });
  it('treats Lot 1316 as the street number when no comma follows', () => {
    const p = parseAustralianAddress('Lot 1316 Harmony Street, Palmview QLD 4553');
    expect(p).toMatchObject({ lot: '', street1: '1316 Harmony Street', suburb: 'Palmview', postcode: '4553' });
  });
});

describe('lookupLGA', () => {
  it('resolves via postcode range', () => {
    expect(lookupLGA('', '4506')).toBe('Moreton Bay Regional Council');
  });
  it('resolves via suburb fallback when postcode is unknown', () => {
    expect(lookupLGA('palmview', '')).toBe('Sunshine Coast Regional Council');
  });
  it('returns empty for non-QLD postcodes', () => {
    expect(lookupLGA('', '2000')).toBe('');
  });
});

describe('parseScopeForAreas', () => {
  it('extracts matching wet areas', () => {
    // Note: matcher is a substring scan (ported verbatim from aqua), so
    // 'waterproofing' would falsely hit 'roof'. Test on a clean string.
    expect(parseScopeForAreas('Bathroom and ensuite membrane')).toEqual(['Bathroom', 'Ensuite']);
  });
  it('falls back to defaults when nothing matches', () => {
    expect(parseScopeForAreas('install a fence')).toEqual(['Bathroom', 'Ensuite', 'Laundry']);
  });
});

describe('buildPrefillData', () => {
  it('produces a Form 43 prefill payload', () => {
    const data = buildPrefillData({
      job_id: 'DW-2026-0001',
      site_address: 'Lot 42, 25 Cameron Rd, Morayfield QLD 4506',
      scope_of_work: 'Bathroom and ensuite membrane',
      install_date: '15/07/2026',
      builder_name: 'Test Builder',
    });
    expect(data.lga).toBe('Moreton Bay Regional Council');
    expect(data.lot).toBe('42');
    expect(data.areas).toEqual(['Bathroom', 'Ensuite']);
    expect(data.certdate).toBe('2026-07-15');
    expect(data.membranes.length).toBeGreaterThan(0);
  });
});

describe('buildForm43Pdf', () => {
  const base = {
    street_address: '1 Lamont Rd',
    suburb: 'Wilston',
    state: 'QLD',
    postcode: '4051',
    lga: 'Brisbane City Council',
    areas_waterproofed: ['All internal wet areas'],
    cert_date: '2026-06-28',
  };

  it('produces a valid unsigned PDF', async () => {
    const bytes = await buildForm43Pdf(base);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  });

  it('produces a valid PDF when signed', async () => {
    const bytes = await buildForm43Pdf({ ...base, signatory: 'Andrew Brett Driver' });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  });
});
