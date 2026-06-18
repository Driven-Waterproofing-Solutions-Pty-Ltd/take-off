import { Point, Unit } from './types';

export const calculateDistance = (p1: Point, p2: Point): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

export const calculatePolylineLength = (points: Point[]): number => {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += calculateDistance(points[i], points[i + 1]);
  }
  return total;
};

// Shoelace formula for polygon area
export const calculatePolygonArea = (points: Point[]): number => {
  if (points.length < 3) return 0;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
};

export const isPointInPolygon = (point: Point, vs: Point[]): boolean => {
  const x = point.x,
    y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x,
      yi = vs[i].y;
    const xj = vs[j].x,
      yj = vs[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const getScaledValue = (pixels: number, pixelsPerUnit: number): number => {
  if (pixelsPerUnit === 0) return 0;
  return pixels / pixelsPerUnit;
};

export const getScaledArea = (pixelArea: number, pixelsPerUnit: number): number => {
  if (pixelsPerUnit === 0) return 0;
  return pixelArea / (pixelsPerUnit * pixelsPerUnit);
};

export const parseDimensionInput = (input: string): number | null => {
  if (!input || !input.trim()) return null;
  const str = input.trim().toLowerCase();

  const parseFraction = (s: string): number => {
    if (s.includes('/')) {
      const parts = s.split('/').map((p) => parseFloat(p));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[1] !== 0) {
        return parts[0] / parts[1];
      }
    }
    return parseFloat(s);
  };

  const parseNumeric = (s: string): number => {
    s = s.trim();
    if (s.includes(' ')) {
      const parts = s.split(/\s+/);
      if (parts.length === 2) {
        return parseFloat(parts[0]) + parseFraction(parts[1]);
      }
    }
    return parseFraction(s);
  };

  if (str.match(/['"]|ft|in/)) {
    let feet = 0;
    let inches = 0;
    const numPat = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';
    const feetRegex = new RegExp(`${numPat}\\s*(?:'|ft)`);
    const feetMatch = str.match(feetRegex);
    if (feetMatch) feet = parseNumeric(feetMatch[1]);
    let remainder = str;
    if (feetMatch) remainder = str.substring(feetMatch.index! + feetMatch[0].length);
    remainder = remainder.replace(/^[\s-]+/, '');
    const inchesRegex = new RegExp(`${numPat}\\s*(?:"|in)?`);
    const inchesMatch = remainder.match(inchesRegex);
    if (inchesMatch && inchesMatch[1]) inches = parseNumeric(inchesMatch[1]);
    return feet + inches / 12;
  }

  if (str.includes('-') && !str.includes('/')) {
    const [f, i] = str.split('-').map(parseFloat);
    if (!isNaN(f) && !isNaN(i)) return f + i / 12;
  }

  const val = parseNumeric(str);
  return isNaN(val) ? null : val;
};

export interface PresetScale {
  label: string;
  pointsPerUnit: number;
  unit: Unit;
  category: 'Architectural' | 'Engineering' | 'Metric';
}

const IMPERIAL_ARCH: PresetScale[] = [
  { label: '1/64" = 1\'0"', pointsPerUnit: (1 / 64) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/32" = 1\'0"', pointsPerUnit: (1 / 32) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/16" = 1\'0"', pointsPerUnit: (1 / 16) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/32" = 1\'0"', pointsPerUnit: (3 / 32) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/8" = 1\'0"', pointsPerUnit: (1 / 8) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/16" = 1\'0"', pointsPerUnit: (3 / 16) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/4" = 1\'0"', pointsPerUnit: (1 / 4) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/8" = 1\'0"', pointsPerUnit: (3 / 8) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/2" = 1\'0"', pointsPerUnit: (1 / 2) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/4" = 1\'0"', pointsPerUnit: (3 / 4) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1" = 1\'0"', pointsPerUnit: 1 * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1-1/2" = 1\'0"', pointsPerUnit: 1.5 * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3" = 1\'0"', pointsPerUnit: 3 * 72, unit: Unit.FEET, category: 'Architectural' },
];

const IMPERIAL_ENG: PresetScale[] = [
  { label: '1" = 10\'', pointsPerUnit: 72 / 10, unit: Unit.FEET, category: 'Engineering' },
  { label: '1" = 20\'', pointsPerUnit: 72 / 20, unit: Unit.FEET, category: 'Engineering' },
  { label: '1" = 30\'', pointsPerUnit: 72 / 30, unit: Unit.FEET, category: 'Engineering' },
  { label: '1" = 40\'', pointsPerUnit: 72 / 40, unit: Unit.FEET, category: 'Engineering' },
  { label: '1" = 50\'', pointsPerUnit: 72 / 50, unit: Unit.FEET, category: 'Engineering' },
  { label: '1" = 60\'', pointsPerUnit: 72 / 60, unit: Unit.FEET, category: 'Engineering' },
  { label: '1" = 100\'', pointsPerUnit: 72 / 100, unit: Unit.FEET, category: 'Engineering' },
];

const METRIC: PresetScale[] = [
  { label: '1:100', pointsPerUnit: 28.3465, unit: Unit.METERS, category: 'Metric' },
  { label: '1:50', pointsPerUnit: 56.6929, unit: Unit.METERS, category: 'Metric' },
  { label: '1:200', pointsPerUnit: 14.1732, unit: Unit.METERS, category: 'Metric' },
  { label: '1:500', pointsPerUnit: 5.6693, unit: Unit.METERS, category: 'Metric' },
];

export const PRESET_SCALES = [...IMPERIAL_ARCH, ...IMPERIAL_ENG, ...METRIC];

export const getAreaUnitFromLinear = (unit: Unit): Unit => {
  switch (unit) {
    case Unit.FEET:
      return Unit.SQ_FT;
    case Unit.INCHES:
      return Unit.SQ_IN;
    case Unit.YARDS:
      return Unit.SQ_YD;
    // getScaledArea returns (linear unit)² — i.e. sq mi / sq km. Mapping to
    // acres/hectares would mislabel without the 640× / 100× conversion, so
    // return the dimensionally-correct squared unit.
    case Unit.MILES:
      return Unit.SQ_MI;
    case Unit.METERS:
      return Unit.SQ_M;
    case Unit.CENTIMETERS:
      return Unit.SQ_CM;
    case Unit.MILLIMETERS:
      return Unit.SQ_MM;
    case Unit.KILOMETERS:
      return Unit.SQ_KM;
    default:
      return unit;
  }
};

const LINEAR_TO_METERS: Partial<Record<Unit, number>> = {
  [Unit.MILLIMETERS]: 0.001,
  [Unit.CENTIMETERS]: 0.01,
  [Unit.METERS]: 1,
  [Unit.KILOMETERS]: 1000,
  [Unit.INCHES]: 0.0254,
  [Unit.FEET]: 0.3048,
  [Unit.YARDS]: 0.9144,
  [Unit.MILES]: 1609.344,
};

export const convertLinearUnit = (value: number, from: Unit, to: Unit): number => {
  if (from === to) return value;
  const a = LINEAR_TO_METERS[from];
  const b = LINEAR_TO_METERS[to];
  if (a === undefined || b === undefined) return value;
  return (value * a) / b;
};

export const getVolumeUnitFromLinear = (unit: Unit): Unit => {
  switch (unit) {
    case Unit.FEET:
      return Unit.CU_FT;
    case Unit.INCHES:
      return Unit.CU_IN;
    case Unit.YARDS:
      return Unit.CU_YD;
    // Without these branches, VOLUME items on mile/km-calibrated pages would
    // keep the linear unit (mi / km) on a cubic quantity — legends and quotes
    // would label area×depth as a length.
    case Unit.MILES:
      return Unit.CU_MI;
    case Unit.METERS:
      return Unit.CU_M;
    case Unit.CENTIMETERS:
      return Unit.CU_CM;
    case Unit.MILLIMETERS:
      return Unit.CU_MM;
    case Unit.KILOMETERS:
      return Unit.CU_KM;
    default:
      return unit;
  }
};

// Strip "sq "/"cu " prefix from a compound unit so an AREA shape (sq m)
// can be tested for compatibility with a VOLUME item (cu m) — both derive
// from the same linear base. The Unit enum stores values with SPACES
// (e.g. "sq ft", "cu m"), not underscores, and there are two named
// exceptions (acres → ft-derived, hectares → m-derived) that we map by
// hand. Bare linear units pass through unchanged.
export const getLinearBase = (unit: string): string => {
  if (unit.startsWith('sq ') || unit.startsWith('cu ')) return unit.slice(3);
  if (unit === 'acres') return 'ft';
  if (unit === 'hectares') return 'm';
  return unit;
};

export const calculateArcPoints = (start: Point, end: Point, bulge: number, segments = 20): Point[] => {
  if (Math.abs(bulge) < 0.001) return [start, end];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  const radius = chordLength / (2 * Math.sin(Math.abs(bulge)));
  const angle = 2 * Math.abs(bulge);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const perpX = -dy / chordLength;
  const perpY = dx / chordLength;
  const distToCenter = radius - chordLength / 2 / Math.tan(angle / 2);
  const centerX = midX + perpX * distToCenter * Math.sign(bulge);
  const centerY = midY + perpY * distToCenter * Math.sign(bulge);
  const startAngle = Math.atan2(start.y - centerY, start.x - centerX);
  const endAngle = Math.atan2(end.y - centerY, end.x - centerX);
  const points: Point[] = [];
  const totalAngle = endAngle - startAngle;
  const normalizedAngle = ((totalAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const arcAngle = bulge > 0 ? normalizedAngle : -(2 * Math.PI - normalizedAngle);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const currentAngle = startAngle + arcAngle * t;
    points.push({
      x: centerX + radius * Math.cos(currentAngle),
      y: centerY + radius * Math.sin(currentAngle),
    });
  }
  return points;
};

export const calculateArcLength = (start: Point, end: Point, bulge: number): number => {
  if (Math.abs(bulge) < 0.001) return calculateDistance(start, end);
  const chordLength = calculateDistance(start, end);
  const radius = chordLength / (2 * Math.sin(Math.abs(bulge)));
  const angle = 2 * Math.abs(bulge);
  return radius * angle;
};
