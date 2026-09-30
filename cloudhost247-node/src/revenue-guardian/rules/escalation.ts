/**
 * Configurable escalation ladder (spec §55). Levels come from the admin-configurable
 * revenue_guardian.escalation_levels setting — nothing here is hard-coded.
 */
import type { RgEscalationLevel } from '../utils/settings';

export interface EscalationInput {
  overdueDays: number;
  brokenPromiseCount: number;
  isPreTermination: boolean;
}

/**
 * Returns the escalation level (0 = none) the case should be at. A broken promise bumps one
 * level; pre-termination forces at least level 3 so imminent revenue loss reaches management.
 */
export function determineEscalationLevel(input: EscalationInput, levels: RgEscalationLevel[]): number {
  const sorted = [...levels].sort((a, b) => a.overdueDays - b.overdueDays);
  let level = 0;
  for (const rung of sorted) {
    if (input.overdueDays >= rung.overdueDays) level = rung.level;
  }
  if (input.brokenPromiseCount > 0) {
    const maxLevel = sorted.length > 0 ? Math.max(...sorted.map((l) => l.level)) : 4;
    level = Math.min(level + 1, maxLevel);
  }
  if (input.isPreTermination) level = Math.max(level, 3);
  return level;
}
