import { Hono } from 'hono';
import { z } from 'zod';
import type { AppType } from '../../shared/types';
import { parseAustralianAddress } from '../../shared/address-parse';
import { lookupLGA } from '../../shared/qld-lga';
import { ok, err } from '../../shared/response';

export const DEFAULT_MEMBRANES = [
  'GCP Silcor 560HB Polyurethane',
  'GCP Silcor 140FB Hybrid',
  'GCP Silcor BS Primer',
  'SAS PU FC 600mm Sausages',
];

export const DEFAULT_AREAS = ['Bathroom', 'Ensuite', 'Laundry'];

const SCOPE_AREA_MAP: Record<string, string> = {
  bathroom: 'Bathroom', ensuite: 'Ensuite', laundry: 'Laundry',
  toilet: 'Toilet', balcony: 'Balcony', deck: 'Deck',
  'retaining wall': 'Retaining Wall', retaining: 'Retaining Wall',
  roof: 'Roof', 'planter box': 'Planter Box', planter: 'Planter Box',
  basement: 'Basement',
};

export function parseScopeForAreas(scope: string): string[] {
  if (!scope) return DEFAULT_AREAS;
  const lower = scope.toLowerCase();
  const out: string[] = [];
  for (const [keyword, area] of Object.entries(SCOPE_AREA_MAP)) {
    if (lower.includes(keyword) && !out.includes(area)) out.push(area);
  }
  return out.length > 0 ? out : DEFAULT_AREAS;
}

export interface PrefillAddress {
  street1: string;
  street2: string;
  state: string;
  postcode: string;
  lga: string;
  unit: string;
  lot: string;
}

export function parseAddressForPrefill(address: string): PrefillAddress {
  const p = parseAustralianAddress(address);
  return {
    street1: p.street1,
    street2: p.suburb,
    state: p.state,
    postcode: p.postcode,
    lga: p.state === 'QLD' ? lookupLGA(p.suburb, p.postcode) : '',
    unit: p.unit,
    lot: p.lot,
  };
}

function normaliseInstallDate(raw: string | undefined): string {
  if (!raw) return new Date().toISOString().split('T')[0];
  if (raw.includes('/')) {
    const [d, m, y] = raw.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}

const PrefillInput = z.object({
  job_id: z.string().optional(),
  site_address: z.string(),
  scope_of_work: z.string().optional(),
  install_date: z.string().optional(),
  builder_name: z.string().optional(),
  lot_number: z.string().optional(),
  purchase_order: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

export type PrefillInputT = z.infer<typeof PrefillInput>;

export function buildPrefillData(input: PrefillInputT) {
  const addr = parseAddressForPrefill(input.site_address || '');
  const areas = parseScopeForAreas(input.scope_of_work || '');

  return {
    job_id: input.job_id || '',
    builder_name: input.builder_name || '',
    street1: addr.street1,
    street2: addr.street2,
    state: addr.state,
    postcode: addr.postcode,
    lot: input.lot_number || addr.lot || '',
    unit: addr.unit || '',
    lga: addr.lga,
    bclass: '1a',
    bdesc: 'New residential dwelling',
    certdate: normaliseInstallDate(input.install_date),
    inspdate: '',
    certref: '',
    danum: input.purchase_order || '',
    membranes: DEFAULT_MEMBRANES,
    areas,
    scope: input.scope_of_work || '',
    contact_name: input.contact_name || '',
    contact_phone: input.contact_phone || '',
  };
}

const router = new Hono<AppType>();

router.post('/prefill', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json(err('Invalid JSON'), 400); }

  const parsed = PrefillInput.safeParse(body);
  if (!parsed.success) return c.json(err(`Invalid input: ${parsed.error.message}`), 400);

  return c.json(ok(buildPrefillData(parsed.data)));
});

export default router;
