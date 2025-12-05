
import { Point, Unit } from '../types';

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
    // ray-casting algorithm
    const x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].x, yi = vs[i].y;
        const xj = vs[j].x, yj = vs[j].y;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
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

export const generateColor = (index: number): string => {
  const colors = [
    '#ef4444', // red
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
  ];
  return colors[index % colors.length];
};

/**
 * Parses a construction dimension string into a decimal number.
 * Supports:
 * - Decimals: "10.5"
 * - Fractions: "1/4", "10 1/2"
 * - Feet & Inches: "10' 6\"", "10ft 6in", "10-6"
 * - Complex formats: "10' - 1/4\"", "10' 1/4\""
 * Returns null if invalid.
 */
export const parseDimensionInput = (input: string): number | null => {
  if (!input || !input.trim()) return null;
  const str = input.trim().toLowerCase();

  const parseFraction = (s: string): number => {
    if (s.includes('/')) {
      const parts = s.split('/').map(p => parseFloat(p));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[1] !== 0) {
        return parts[0] / parts[1];
      }
    }
    return parseFloat(s);
  };

  const parseNumeric = (s: string): number => {
    s = s.trim();
    // Handle "10 1/2" -> split by space
    if (s.includes(' ')) {
      const parts = s.split(/\s+/);
      if (parts.length === 2) {
         return parseFloat(parts[0]) + parseFraction(parts[1]);
      }
    }
    return parseFraction(s);
  };

  // Check for Feet/Inches format (contains ' or " or ft or in)
  if (str.match(/['"]|ft|in/)) {
    let feet = 0;
    let inches = 0;

    // Pattern for a number:
    // 1. Whole + Fraction: \d+ \d+/\d+ (e.g., 10 1/2)
    // 2. Fraction: \d+/\d+ (e.g., 1/4)
    // 3. Decimal/Integer: \d+(\.\d+)? (e.g., 10.5 or 10)
    // We use capturing group for the whole number part
    const numPat = "(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)";

    // Extract Feet
    const feetRegex = new RegExp(`${numPat}\\s*(?:'|ft)`);
    const feetMatch = str.match(feetRegex);
    
    if (feetMatch) {
      feet = parseNumeric(feetMatch[1]);
    }

    // Extract Inches from remainder
    let remainder = str;
    if (feetMatch) {
      remainder = str.substring(feetMatch.index! + feetMatch[0].length);
    }
    
    // Remove leading separators like " - ", "-", " "
    remainder = remainder.replace(/^[\s-]+/, '');

    // Extract Inches
    const inchesRegex = new RegExp(`${numPat}\\s*(?:"|in)?`);
    const inchesMatch = remainder.match(inchesRegex);
    
    if (inchesMatch) {
       if (inchesMatch[1]) {
         inches = parseNumeric(inchesMatch[1]);
       }
    }

    return feet + (inches / 12);
  }

  // Handle "10-6" format (10 feet 6 inches) often used in construction
  if (str.includes('-') && !str.includes('/')) {
    const [f, i] = str.split('-').map(parseFloat);
    if (!isNaN(f) && !isNaN(i)) {
      return f + (i / 12);
    }
  }

  // Fallback for simple numbers or simple fractions ("1/4" without units)
  const val = parseNumeric(str);
  return isNaN(val) ? null : val;
};

// Preset Scales
// pointsPerUnit: How many PDF points (1/72 inch) represent 1 Real Unit.
export interface PresetScale {
  label: string;
  pointsPerUnit: number;
  unit: Unit;
  category: 'Architectural' | 'Engineering' | 'Metric';
}

const IMPERIAL_ARCH: PresetScale[] = [
  { label: '1/64" = 1\'0"', pointsPerUnit: (1/64) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/32" = 1\'0"', pointsPerUnit: (1/32) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/16" = 1\'0"', pointsPerUnit: (1/16) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/32" = 1\'0"', pointsPerUnit: (3/32) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/8" = 1\'0"', pointsPerUnit: (1/8) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/16" = 1\'0"', pointsPerUnit: (3/16) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/4" = 1\'0"', pointsPerUnit: (1/4) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/8" = 1\'0"', pointsPerUnit: (3/8) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '1/2" = 1\'0"', pointsPerUnit: (1/2) * 72, unit: Unit.FEET, category: 'Architectural' },
  { label: '3/4" = 1\'0"', pointsPerUnit: (3/4) * 72, unit: Unit.FEET, category: 'Architectural' },
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
  // 1:100 means 1 unit paper = 100 units real.
  // We use Meters as base.
  // 1m Real = 10mm paper.
  // 10mm = 0.3937 inches.
  // Points = 0.3937 * 72 = 28.35 pts per Meter.
  { label: '1:100', pointsPerUnit: 28.3465, unit: Unit.METERS, category: 'Metric' },
  { label: '1:50', pointsPerUnit: 56.6929, unit: Unit.METERS, category: 'Metric' },
  { label: '1:200', pointsPerUnit: 14.1732, unit: Unit.METERS, category: 'Metric' },
  { label: '1:500', pointsPerUnit: 5.6693, unit: Unit.METERS, category: 'Metric' },
];

export const PRESET_SCALES = [...IMPERIAL_ARCH, ...IMPERIAL_ENG, ...METRIC];

export const getAreaUnitFromLinear = (unit: Unit): Unit => {
  switch (unit) {
    case Unit.FEET: return Unit.SQ_FT;
    case Unit.INCHES: return Unit.SQ_IN;
    case Unit.YARDS: return Unit.SQ_YD;
    case Unit.MILES: return Unit.ACRES;
    case Unit.METERS: return Unit.SQ_M;
    case Unit.CENTIMETERS: return Unit.SQ_CM;
    case Unit.MILLIMETERS: return Unit.SQ_MM;
    case Unit.KILOMETERS: return Unit.HECTARES;
    default: return unit;
  }
};

export const getVolumeUnitFromLinear = (unit: Unit): Unit => {
  switch (unit) {
    case Unit.FEET: return Unit.CU_FT;
    case Unit.INCHES: return Unit.CU_IN;
    case Unit.YARDS: return Unit.CU_YD;
    case Unit.METERS: return Unit.CU_M;
    case Unit.CENTIMETERS: return Unit.CU_CM;
    case Unit.MILLIMETERS: return Unit.CU_MM;
    default: return unit;
  }
};
