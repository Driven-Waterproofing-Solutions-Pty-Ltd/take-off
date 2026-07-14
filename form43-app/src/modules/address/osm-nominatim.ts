/**
 * OpenStreetMap Nominatim fallback. Active when GEOSCAPE_API_KEY is absent.
 * Nominatim usage policy:
 *   - 1 req/s max
 *   - Identifying User-Agent required
 *   - No heavy bulk use
 * See https://operations.osmfoundation.org/policies/nominatim/
 */

import type { AddressCandidate } from '../../shared/types';
import { cacheGet, cacheSet } from './cache';

const BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'form43-app/0.1 (office@drivenwp.com)';
const TIMEOUT_MS = 8000;

interface NominatimItem {
  osm_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    state?: string;
    postcode?: string;
    house_number?: string;
  };
}

export async function osmSearch(query: string, db: D1Database, limit = 10): Promise<AddressCandidate[]> {
  const cached = await cacheGet<AddressCandidate[]>(db, 'osm', query);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: query,
    countrycodes: 'au',
    format: 'json',
    addressdetails: '1',
    limit: String(Math.min(limit, 10)),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/search?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Nominatim failed: HTTP ${res.status}`);
    const items = await res.json() as NominatimItem[];

    const candidates: AddressCandidate[] = items.map((it) => {
      const addr = it.address ?? {};
      const number = addr.house_number ?? '';
      const road = addr.road ?? '';
      const street1 = [number, road].filter(Boolean).join(' ').trim() || undefined;
      const suburb = addr.suburb || addr.neighbourhood || addr.city || addr.town;
      return {
        id: String(it.osm_id),
        formatted: it.display_name,
        street1,
        suburb,
        state: addr.state ? mapAuState(addr.state) : undefined,
        postcode: addr.postcode,
        lat: parseFloat(it.lat),
        lng: parseFloat(it.lon),
      };
    });

    await cacheSet(db, {
      provider: 'osm',
      query_text: query,
      response: candidates,
      lat: candidates[0]?.lat ?? null,
      lng: candidates[0]?.lng ?? null,
    });

    return candidates;
  } finally {
    clearTimeout(timer);
  }
}

function mapAuState(stateName: string): string {
  const map: Record<string, string> = {
    queensland: 'QLD', 'new south wales': 'NSW', victoria: 'VIC',
    'western australia': 'WA', 'south australia': 'SA',
    'northern territory': 'NT', 'australian capital territory': 'ACT',
    tasmania: 'TAS',
  };
  return map[stateName.toLowerCase()] || stateName.toUpperCase();
}
