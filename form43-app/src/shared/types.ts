import type { Env, RequestVars } from '../env';

export type AppType = { Bindings: Env; Variables: RequestVars };

export interface Form43Record {
  id: number;
  job_id: string | null;
  street_address: string;
  suburb: string | null;
  postcode: string | null;
  lga: string | null;
  building_class: string;
  building_desc: string;
  products_used: string[];
  areas_waterproofed: string[];
  certifier_ref: string | null;
  da_number: string | null;
  insp_date: string | null;
  cert_date: string | null;
  notes: string | null;
  generated_by: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type MemoryType = 'LONG_TERM' | 'SHORT_TERM' | 'PINNED';
export type MemoryCategory = 'PREFERENCE' | 'FACT' | 'DECISION' | 'BUILDER' | 'GENERAL';

export interface MemoryRow {
  id: number;
  memory_type: MemoryType;
  category: MemoryCategory;
  content: string;
  source_session_id: string | null;
  times_referenced: number;
  expires_at: string | null;
  never_expires: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AddressLookupResult {
  provider: 'geoscape_predictive' | 'geoscape_verify' | 'osm' | 'cache';
  query: string;
  candidates: AddressCandidate[];
}

export interface AddressCandidate {
  id?: string;        // GNAF PID or OSM osm_id
  formatted: string;
  street1?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  lat?: number;
  lng?: number;
  lga?: string;
}
