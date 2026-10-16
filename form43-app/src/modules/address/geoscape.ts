/**
 * Geoscape Predictive Address & Property API client.
 *
 * Geoscape is the official Australian national address dataset (G-NAF):
 * https://geoscape.com.au/. It is sourced from state land authorities,
 * AusPost, and the ABS, and is updated weekly with quarterly G-NAF base
 * releases. This is the best AU accuracy & freshness available.
 *
 * Endpoints used:
 *   GET /v1/predictive/address?query=...   → candidates (with GNAF PID)
 *   GET /v1/addresses/{gnafPid}            → full structured + lat/lng
 *
 * Auth header is a raw key (NOT Bearer): `Authorization: <GEOSCAPE_API_KEY>`.
 */

import type { AddressCandidate } from '../../shared/types';
import { cacheGet, cacheSet } from './cache';

const BASE = 'https://api.psma.com.au';
const TIMEOUT_MS = 8000;

export interface GeoscapePredictiveItem {
  id: string;
  address: string;
}

export interface GeoscapeVerifyItem {
  pid: string;
  formattedAddress: string;
  addressDetails?: {
    localityName?: string;
    postcode?: string;
    stateTerritory?: string;
    streetName?: string;
    streetNumber1?: string;
    streetType?: string;
  };
  geo?: { geometry?: { coordinates?: [number, number] } };
}

async function geoscapeFetch(path: string, apiKey: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function predictiveSearch(
  query: string,
  apiKey: string,
  db: D1Database,
  opts: { limit?: number; state?: string } = {},
): Promise<AddressCandidate[]> {
  const cached = await cacheGet<AddressCandidate[]>(db, 'geoscape_predictive', query);
  if (cached) return cached;

  const limit = Math.min(opts.limit ?? 10, 10);
  const params = new URLSearchParams({ query, maxNumberOfResults: String(limit) });
  if (opts.state) params.set('stateTerritory', opts.state);

  const res = await geoscapeFetch(`/v1/predictive/address?${params.toString()}`, apiKey);
  if (!res.ok) throw new Error(`Geoscape predictive failed: HTTP ${res.status}`);
  const json = await res.json() as { suggest?: GeoscapePredictiveItem[] };
  const items = json.suggest ?? [];

  const candidates: AddressCandidate[] = items.map((it) => ({
    id: it.id,
    formatted: it.address,
  }));

  await cacheSet(db, {
    provider: 'geoscape_predictive',
    query_text: query,
    response: candidates,
    lat: null,
    lng: null,
  });

  return candidates;
}

export async function verifyByPid(
  pid: string,
  apiKey: string,
  db: D1Database,
): Promise<AddressCandidate | null> {
  const cached = await cacheGet<AddressCandidate>(db, 'geoscape_verify', pid);
  if (cached) return cached;

  const res = await geoscapeFetch(`/v1/addresses/${encodeURIComponent(pid)}`, apiKey);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Geoscape verify failed: HTTP ${res.status}`);
  }
  const item = await res.json() as GeoscapeVerifyItem;
  const coords = item.geo?.geometry?.coordinates;
  const [lng, lat] = coords ?? [undefined, undefined];

  const detail = item.addressDetails;
  const candidate: AddressCandidate = {
    id: item.pid,
    formatted: item.formattedAddress,
    street1: detail ? [detail.streetNumber1, detail.streetName, detail.streetType].filter(Boolean).join(' ') : undefined,
    suburb: detail?.localityName,
    state: detail?.stateTerritory,
    postcode: detail?.postcode,
    lat, lng,
  };

  await cacheSet(db, {
    provider: 'geoscape_verify',
    query_text: pid,
    response: candidate,
    lat: lat ?? null,
    lng: lng ?? null,
  });

  return candidate;
}
