import { Hono } from 'hono';
import { z } from 'zod';
import type { AppType, AddressLookupResult } from '../../shared/types';
import { parseAustralianAddress } from '../../shared/address-parse';
import { lookupLGA } from '../../shared/qld-lga';
import { predictiveSearch, verifyByPid } from './geoscape';
import { osmSearch } from './osm-nominatim';
import { rateLimit } from '../../middleware/rate-limit';
import { ok, err } from '../../shared/response';

const router = new Hono<AppType>();

router.get('/autocomplete', rateLimit('address_autocomplete'), async (c) => {
  const query = (c.req.query('q') || '').trim();
  if (!query) return c.json(err('Missing q'), 400);
  const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 10);
  const state = c.req.query('state');

  try {
    let candidates;
    let provider: AddressLookupResult['provider'];

    if (c.env.GEOSCAPE_API_KEY) {
      candidates = await predictiveSearch(query, c.env.GEOSCAPE_API_KEY, c.env.FORM43_DB, { limit, state });
      provider = 'geoscape_predictive';
    } else {
      candidates = await osmSearch(query, c.env.FORM43_DB, limit);
      provider = 'osm';
    }

    // Compute LGA for QLD candidates that came with structured suburb+postcode.
    for (const cand of candidates) {
      if (!cand.lga && cand.state === 'QLD' && cand.suburb && cand.postcode) {
        cand.lga = lookupLGA(cand.suburb, cand.postcode);
      }
    }

    return c.json(ok({ provider, query, candidates } satisfies AddressLookupResult));
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 502);
  }
});

const VerifyInput = z.object({
  address: z.string().optional(),
  gnaf_pid: z.string().optional(),
}).refine((v) => v.address || v.gnaf_pid, { message: 'Provide address or gnaf_pid' });

router.get('/verify', rateLimit('address_verify'), async (c) => {
  const input = VerifyInput.safeParse({
    address: c.req.query('address'),
    gnaf_pid: c.req.query('gnaf_pid'),
  });
  if (!input.success) return c.json(err(input.error.message), 400);

  try {
    if (c.env.GEOSCAPE_API_KEY) {
      let pid = input.data.gnaf_pid;
      if (!pid && input.data.address) {
        const preds = await predictiveSearch(input.data.address, c.env.GEOSCAPE_API_KEY, c.env.FORM43_DB, { limit: 1 });
        pid = preds[0]?.id;
      }
      if (!pid) return c.json(err('No GNAF match'), 404);
      const cand = await verifyByPid(pid, c.env.GEOSCAPE_API_KEY, c.env.FORM43_DB);
      if (!cand) return c.json(err('GNAF PID not found'), 404);
      if (!cand.lga && cand.state === 'QLD' && cand.suburb && cand.postcode) {
        cand.lga = lookupLGA(cand.suburb, cand.postcode);
      }
      return c.json(ok({ provider: 'geoscape_verify', query: input.data.address || pid, candidates: [cand] } satisfies AddressLookupResult));
    }

    // OSM fallback verify = first search result.
    const cands = await osmSearch(input.data.address || '', c.env.FORM43_DB, 1);
    if (cands.length === 0) return c.json(err('No OSM match'), 404);
    if (!cands[0].lga && cands[0].state === 'QLD' && cands[0].suburb && cands[0].postcode) {
      cands[0].lga = lookupLGA(cands[0].suburb, cands[0].postcode);
    }
    return c.json(ok({ provider: 'osm', query: input.data.address ?? '', candidates: cands } satisfies AddressLookupResult));
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 502);
  }
});

router.get('/parse', (c) => {
  const raw = (c.req.query('raw') || '').trim();
  if (!raw) return c.json(err('Missing raw'), 400);
  const parsed = parseAustralianAddress(raw);
  const lga = parsed.state === 'QLD' ? lookupLGA(parsed.suburb, parsed.postcode) : '';
  return c.json(ok({ parsed, lga }));
});

export default router;
