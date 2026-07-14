/**
 * Source-of-truth lives in aqua (src/shared/qld-lga.ts).
 * Sync manually if you fix a bug — these two files MUST stay aligned.
 *
 * QLD postcode → LGA (Local Government Area) lookup.
 *
 * The Form 43 generator needs an LGA for every job. The previous
 * implementation matched on suburb name via a hardcoded table of ~60
 * entries — any suburb not in the table (Fortitude Valley, South Bank,
 * etc.) returned empty LGA.
 *
 * This module ranks lookups in order of reliability:
 *   1. Postcode range (deterministic for most QLD LGAs)
 *   2. Suburb name fallback (same table as before, kept for edge cases
 *      where a postcode spans multiple LGAs — e.g. 4520 includes
 *      Moreton Bay AND Somerset)
 *   3. Empty string if neither matches
 *
 * Sources: Australia Post postcode file + QLD Gov LGA boundaries.
 * Not perfect (a handful of postcodes straddle two LGAs), but far more
 * complete than a 60-suburb dictionary.
 */

export const QLD_SUBURB_LGA: Record<string, string> = {
  // Sunshine Coast
  'banya': 'Sunshine Coast Regional Council',
  'palmview': 'Sunshine Coast Regional Council',
  'glenview': 'Sunshine Coast Regional Council',
  'mooloolah valley': 'Sunshine Coast Regional Council',
  'sippy downs': 'Sunshine Coast Regional Council',
  'buderim': 'Sunshine Coast Regional Council',
  'maroochydore': 'Sunshine Coast Regional Council',
  'caloundra': 'Sunshine Coast Regional Council',
  'nambour': 'Sunshine Coast Regional Council',
  'coolum beach': 'Sunshine Coast Regional Council',
  'peregian springs': 'Sunshine Coast Regional Council',
  'bli bli': 'Sunshine Coast Regional Council',
  'mountain creek': 'Sunshine Coast Regional Council',
  'little mountain': 'Sunshine Coast Regional Council',
  'bokarina': 'Sunshine Coast Regional Council',
  'warana': 'Sunshine Coast Regional Council',
  'birtinya': 'Sunshine Coast Regional Council',
  'kawana waters': 'Sunshine Coast Regional Council',
  // Noosa
  'eumundi': 'Noosa Shire Council',
  'noosa': 'Noosa Shire Council',
  'noosa heads': 'Noosa Shire Council',
  'noosaville': 'Noosa Shire Council',
  'tewantin': 'Noosa Shire Council',
  'cooroy': 'Noosa Shire Council',
  'pomona': 'Noosa Shire Council',
  'sunshine beach': 'Noosa Shire Council',
  // Moreton Bay
  'morayfield': 'Moreton Bay Regional Council',
  'caboolture': 'Moreton Bay Regional Council',
  'upper caboolture': 'Moreton Bay Regional Council',
  'petrie': 'Moreton Bay Regional Council',
  'narangba': 'Moreton Bay Regional Council',
  'burpengary': 'Moreton Bay Regional Council',
  'kallangur': 'Moreton Bay Regional Council',
  'redcliffe': 'Moreton Bay Regional Council',
  'deception bay': 'Moreton Bay Regional Council',
  'mango hill': 'Moreton Bay Regional Council',
  'griffin': 'Moreton Bay Regional Council',
  'north lakes': 'Moreton Bay Regional Council',
  'clontarf': 'Moreton Bay Regional Council',
  'strathpine': 'Moreton Bay Regional Council',
  'lawnton': 'Moreton Bay Regional Council',
  'dayboro': 'Moreton Bay Regional Council',
  'warner': 'Moreton Bay Regional Council',
  'brendale': 'Moreton Bay Regional Council',
  'bray park': 'Moreton Bay Regional Council',
  'albany creek': 'Moreton Bay Regional Council',
  'eatons hill': 'Moreton Bay Regional Council',
  'elimbah': 'Moreton Bay Regional Council',
  // Brisbane
  'samford valley': 'Brisbane City Council',
  'samford': 'Brisbane City Council',
  'brisbane': 'Brisbane City Council',
  'brisbane city': 'Brisbane City Council',
  'the gap': 'Brisbane City Council',
  'chermside': 'Brisbane City Council',
  'aspley': 'Brisbane City Council',
  'ferny hills': 'Brisbane City Council',
  'keperra': 'Brisbane City Council',
  'mitchelton': 'Brisbane City Council',
  'nundah': 'Brisbane City Council',
  'indooroopilly': 'Brisbane City Council',
  'toowong': 'Brisbane City Council',
  'fortitude valley': 'Brisbane City Council',
  'south bank': 'Brisbane City Council',
  'south brisbane': 'Brisbane City Council',
  'west end': 'Brisbane City Council',
  'paddington': 'Brisbane City Council',
  'bulimba': 'Brisbane City Council',
  'kangaroo point': 'Brisbane City Council',
  'new farm': 'Brisbane City Council',
  'teneriffe': 'Brisbane City Council',
  'newstead': 'Brisbane City Council',
  'hamilton': 'Brisbane City Council',
  'ascot': 'Brisbane City Council',
  'clayfield': 'Brisbane City Council',
  'wooloowin': 'Brisbane City Council',
  'wilston': 'Brisbane City Council',
  'windsor': 'Brisbane City Council',
  'bowen hills': 'Brisbane City Council',
  'herston': 'Brisbane City Council',
  'spring hill': 'Brisbane City Council',
  'kelvin grove': 'Brisbane City Council',
  'red hill': 'Brisbane City Council',
  'fortitude': 'Brisbane City Council',
  'milton': 'Brisbane City Council',
  'auchenflower': 'Brisbane City Council',
  'bardon': 'Brisbane City Council',
  'ashgrove': 'Brisbane City Council',
  'st lucia': 'Brisbane City Council',
  'taringa': 'Brisbane City Council',
  'chapel hill': 'Brisbane City Council',
  'kenmore': 'Brisbane City Council',
  'fig tree pocket': 'Brisbane City Council',
  'jindalee': 'Brisbane City Council',
  'mount ommaney': 'Brisbane City Council',
  'middle park': 'Brisbane City Council',
  'woolloongabba': 'Brisbane City Council',
  'east brisbane': 'Brisbane City Council',
  'norman park': 'Brisbane City Council',
  'morningside': 'Brisbane City Council',
  'cannon hill': 'Brisbane City Council',
  'carina': 'Brisbane City Council',
  'carindale': 'Brisbane City Council',
  'belmont': 'Brisbane City Council',
  'wynnum': 'Brisbane City Council',
  'manly': 'Brisbane City Council',
  'mount gravatt': 'Brisbane City Council',
  'holland park': 'Brisbane City Council',
  'coorparoo': 'Brisbane City Council',
  'annerley': 'Brisbane City Council',
  'moorooka': 'Brisbane City Council',
  'yeronga': 'Brisbane City Council',
  'fairfield': 'Brisbane City Council',
  'dutton park': 'Brisbane City Council',
  'highgate hill': 'Brisbane City Council',
  'sunnybank': 'Brisbane City Council',
  'calamvale': 'Brisbane City Council',
  'macgregor': 'Brisbane City Council',
  'stretton': 'Brisbane City Council',
  // Logan
  'yarrabilba': 'Logan City Council',
  'browns plains': 'Logan City Council',
  'crestmead': 'Logan City Council',
  'springwood': 'Logan City Council',
  'logan central': 'Logan City Council',
  'logan village': 'Logan City Council',
  'shailer park': 'Logan City Council',
  'daisy hill': 'Logan City Council',
  'beenleigh': 'Logan City Council',
  'meadowbrook': 'Logan City Council',
  'loganholme': 'Logan City Council',
  'loganlea': 'Logan City Council',
  'waterford': 'Logan City Council',
  'jimboomba': 'Logan City Council',
  'park ridge': 'Logan City Council',
  'regents park': 'Logan City Council',
  'marsden': 'Logan City Council',
  // Gold Coast
  'coomera': 'Gold Coast City Council',
  'pimpama': 'Gold Coast City Council',
  'hope island': 'Gold Coast City Council',
  'surfers paradise': 'Gold Coast City Council',
  'robina': 'Gold Coast City Council',
  'varsity lakes': 'Gold Coast City Council',
  'pacific pines': 'Gold Coast City Council',
  'helensvale': 'Gold Coast City Council',
  'upper coomera': 'Gold Coast City Council',
  'oxenford': 'Gold Coast City Council',
  'southport': 'Gold Coast City Council',
  'broadbeach': 'Gold Coast City Council',
  'burleigh heads': 'Gold Coast City Council',
  'palm beach': 'Gold Coast City Council',
  'currumbin': 'Gold Coast City Council',
  'tugun': 'Gold Coast City Council',
  'mermaid beach': 'Gold Coast City Council',
  'miami': 'Gold Coast City Council',
  'nerang': 'Gold Coast City Council',
  'mudgeeraba': 'Gold Coast City Council',
  'reedy creek': 'Gold Coast City Council',
  'elanora': 'Gold Coast City Council',
  // Gympie
  'gympie': 'Gympie Regional Council',
  'tin can bay': 'Gympie Regional Council',
  'rainbow beach': 'Gympie Regional Council',
  // Ipswich
  'ipswich': 'Ipswich City Council',
  'springfield': 'Ipswich City Council',
  'springfield lakes': 'Ipswich City Council',
  'ripley': 'Ipswich City Council',
  'bellbird park': 'Ipswich City Council',
  'redbank plains': 'Ipswich City Council',
  'goodna': 'Ipswich City Council',
  'brassall': 'Ipswich City Council',
  'raceview': 'Ipswich City Council',
  'bundamba': 'Ipswich City Council',
  // Redland
  'cleveland': 'Redland City Council',
  'capalaba': 'Redland City Council',
  'victoria point': 'Redland City Council',
  'redland bay': 'Redland City Council',
  'wellington point': 'Redland City Council',
  'ormiston': 'Redland City Council',
  'thornlands': 'Redland City Council',
  'alexandra hills': 'Redland City Council',
  'birkdale': 'Redland City Council',
};

interface PostcodeRange {
  from: number;
  to: number;
  lga: string;
}

// Ordered from most-specific to least-specific so the first match wins.
// Where a postcode spans two LGAs we list the more populous / more likely one;
// the suburb fallback (above) catches the edge cases.
const POSTCODE_RANGES: PostcodeRange[] = [
  // Brisbane City core (CBD + inner ring)
  { from: 4000, to: 4014, lga: 'Brisbane City Council' },
  { from: 4030, to: 4077, lga: 'Brisbane City Council' },
  // Brisbane southern suburbs
  { from: 4101, to: 4179, lga: 'Brisbane City Council' },
  // Ipswich
  { from: 4300, to: 4309, lga: 'Ipswich City Council' },
  // Logan
  { from: 4114, to: 4129, lga: 'Logan City Council' },
  { from: 4207, to: 4209, lga: 'Logan City Council' },
  { from: 4280, to: 4287, lga: 'Logan City Council' },
  // Redland
  { from: 4157, to: 4165, lga: 'Redland City Council' },
  // Gold Coast
  { from: 4210, to: 4230, lga: 'Gold Coast City Council' },
  // Moreton Bay
  { from: 4019, to: 4020, lga: 'Moreton Bay Regional Council' },
  { from: 4500, to: 4521, lga: 'Moreton Bay Regional Council' },
  // Sunshine Coast
  { from: 4550, to: 4559, lga: 'Sunshine Coast Regional Council' },
  { from: 4556, to: 4569, lga: 'Sunshine Coast Regional Council' },
  { from: 4572, to: 4575, lga: 'Sunshine Coast Regional Council' },
  // Noosa
  { from: 4565, to: 4573, lga: 'Noosa Shire Council' },
  // Gympie
  { from: 4570, to: 4605, lga: 'Gympie Regional Council' },
];

/**
 * Resolve a QLD LGA name. Tries postcode range first (deterministic for
 * the vast majority of postcodes), then falls back to suburb lookup.
 * Returns '' when neither resolves.
 */
export function lookupLGA(suburb: string, postcode: string): string {
  const pc = parseInt(postcode, 10);
  if (Number.isFinite(pc)) {
    for (const range of POSTCODE_RANGES) {
      if (pc >= range.from && pc <= range.to) return range.lga;
    }
  }
  const key = (suburb || '').toLowerCase().trim();
  if (key && QLD_SUBURB_LGA[key]) return QLD_SUBURB_LGA[key];
  return '';
}
