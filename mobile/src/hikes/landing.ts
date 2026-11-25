// "Bad landing" rule from frontend/hike-charts.js: a hard hit taken on a
// nearly straight knee. Both must be true:
//   1. impact >= the hike's high-impact threshold (2.0 g by default)
//   2. knee bent less than 15 deg at impact
// This is a heuristic for reviewing technique, not a clinical measure.

import type { Impact } from './stats';

export const DEFAULT_HIGH_IMPACT = 2.0;
export const MAX_BEND_FOR_BAD_LANDING = 15;

// Hikes recorded since the web app's calibration change store 180 =
// straight; older ones store 0 = straight. The median tells them apart.
export function angleConvention(angles: number[]) {
  const sorted = [...angles].sort((a, b) => a - b);
  const straightIs180 = sorted.length > 0 && sorted[Math.floor(sorted.length / 2)] > 90;
  return {
    straightIs180,
    bend: (angle: number) => (straightIs180 ? 180 - angle : angle),
    angleLimit: straightIs180 ? 180 - MAX_BEND_FOR_BAD_LANDING : MAX_BEND_FOR_BAD_LANDING,
  };
}

export function classifyLandings(impacts: Impact[], highImpact = DEFAULT_HIGH_IMPACT) {
  const convention = angleConvention(impacts.map((i) => i.angle));
  const bad = impacts.map((i) => i.accel >= highImpact && convention.bend(i.angle) < MAX_BEND_FOR_BAD_LANDING);
  return { ...convention, bad, badCount: bad.filter(Boolean).length };
}
