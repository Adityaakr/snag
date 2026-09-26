/**
 * Calibration maps raw model probabilities to observed accuracy per question key (BUILD_PROMPT 11.5). A map
 * applies only to the Jev model and question set it was fitted for.
 */
export interface CalibrationPoint {
  x: number;
  y: number;
}

export interface Calibration {
  id: string;
  jevModel: string;
  questionSet: string;
  /** Question key (for example `forward.coverage.level3`) to monotone points; missing keys use identity. */
  maps: Record<string, CalibrationPoint[]>;
  /** Labeled findings the calibration was measured on, and the measured P0 precision (for gate mode). */
  labeledFindings: number;
  p0Precision: number;
  /** Thresholds tuned on dev with this calibration applied (11.5); they replace the config values while it is active. */
  thresholds?: Record<string, number>;
}

/** Piecewise-linear interpolation over sorted points; identity outside a map. */
export function applyMap(points: readonly CalibrationPoint[] | undefined, p: number): number {
  if (!points || points.length === 0) return p;
  const pts = [...points].sort((a, b) => a.x - b.x);
  const first = pts[0] as CalibrationPoint;
  const last = pts[pts.length - 1] as CalibrationPoint;
  if (p <= first.x) return first.y;
  if (p >= last.x) return last.y;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as CalibrationPoint;
    const b = pts[i] as CalibrationPoint;
    if (p <= b.x) return b.x === a.x ? b.y : a.y + ((p - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return p;
}

/** A calibrator bound to one calibration, or identity when none applies. */
export interface Calibrator {
  calibrated: boolean;
  value(key: string, p: number): number;
}

export function calibrator(cal: Calibration | undefined, jevModel: string, questionSet: string): Calibrator {
  if (!cal || cal.jevModel !== jevModel || cal.questionSet !== questionSet)
    return { calibrated: false, value: (_k, p) => p };
  return { calibrated: true, value: (k, p) => applyMap(cal.maps[k], p) };
}

/** The config thresholds, with the calibration's tuned values on top when the calibration applies. */
export function tunedThresholds<T extends Record<string, number>>(
  thresholds: T,
  cal: Calibration | undefined,
  jevModel: string,
  questionSet: string,
): T {
  if (!cal?.thresholds || cal.jevModel !== jevModel || cal.questionSet !== questionSet) return thresholds;
  const out: Record<string, number> = { ...thresholds };
  for (const [k, v] of Object.entries(cal.thresholds)) if (k in thresholds) out[k] = v;
  return out as T;
}
