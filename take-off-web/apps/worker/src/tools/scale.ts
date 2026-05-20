import {
  PRESET_SCALES,
  calculateDistance,
  ScaleCalibration,
  Unit,
  Point,
} from '@takeoff/shared';
import type { Env } from '../env';
import { upsertPage } from '../db/queries';

export async function setScalePreset(
  env: Env,
  args: { project_id: string; page_index: number; preset_label: string }
): Promise<ScaleCalibration> {
  const preset = PRESET_SCALES.find((p) => p.label === args.preset_label);
  if (!preset) {
    throw new Error(
      `Unknown preset "${args.preset_label}". Available: ${PRESET_SCALES.map((p) => p.label).join(', ')}`
    );
  }
  const scale: ScaleCalibration = {
    isSet: true,
    pixelsPerUnit: preset.pointsPerUnit,
    unit: preset.unit,
  };
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  return scale;
}

export async function setScaleManual(
  env: Env,
  args: {
    project_id: string;
    page_index: number;
    p1: Point;
    p2: Point;
    real_distance: number;
    unit: Unit;
  }
): Promise<ScaleCalibration> {
  const pixelDistance = calculateDistance(args.p1, args.p2);
  if (pixelDistance <= 0) throw new Error('Calibration points are identical');
  if (args.real_distance <= 0) throw new Error('Real distance must be > 0');

  const scale: ScaleCalibration = {
    isSet: true,
    pixelsPerUnit: pixelDistance / args.real_distance,
    unit: args.unit,
  };
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  return scale;
}
