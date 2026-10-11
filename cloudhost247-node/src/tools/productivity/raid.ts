/**
 * RAID capacity and fault-tolerance calculator.
 *
 * Pure arithmetic from the standard layouts. Capacities are reported in decimal terabytes (how drive
 * vendors label them, 1 TB = 10^12 bytes) and in tebibytes (what most operating systems display,
 * 1 TiB = 2^40 bytes). Real arrays lose additional space to metadata, filesystem formatting and
 * hot spares, which this calculator does not model; the output says so.
 */

export const RAID_LEVELS = ['0', '1', '5', '6', '10'] as const;
export type RaidLevel = (typeof RAID_LEVELS)[number];

export interface RaidInput {
  level: RaidLevel;
  drives: number;
  driveSizeTb: number;
}

export interface RaidResult {
  level: RaidLevel;
  drives: number;
  driveSizeTb: number;
  rawTb: number;
  usableTb: number;
  usableTib: number;
  overheadPct: number;
  /** Drive failures the array survives in every case. */
  guaranteedFailures: number;
  /** Largest number of simultaneous drive failures that can still be survived in the best case. */
  bestCaseFailures: number;
  minDrives: number;
  description: string;
  warnings: string[];
}

const BYTES_PER_TB = 1e12;
const BYTES_PER_TIB = 2 ** 40;
const LIMITS = { maxDrives: 1000, minSizeTb: 0.001, maxSizeTb: 100_000 };

export class RaidInputError extends Error {}

const MIN_DRIVES: Record<RaidLevel, number> = { '0': 2, '1': 2, '5': 3, '6': 4, '10': 4 };

export function computeRaid(input: RaidInput): RaidResult {
  const { level, drives, driveSizeTb } = input;
  if (!RAID_LEVELS.includes(level)) throw new RaidInputError('Choose RAID 0, 1, 5, 6 or 10.');
  if (!Number.isInteger(drives) || drives < 1 || drives > LIMITS.maxDrives) {
    throw new RaidInputError(`Drive count must be a whole number from 1 to ${LIMITS.maxDrives}.`);
  }
  if (!Number.isFinite(driveSizeTb) || driveSizeTb < LIMITS.minSizeTb || driveSizeTb > LIMITS.maxSizeTb) {
    throw new RaidInputError(`Drive size must be between ${LIMITS.minSizeTb} and ${LIMITS.maxSizeTb.toLocaleString('en-US')} TB.`);
  }
  const minDrives = MIN_DRIVES[level];
  if (drives < minDrives) throw new RaidInputError(`RAID ${level} needs at least ${minDrives} drives.`);
  if (level === '10' && drives % 2 !== 0) throw new RaidInputError('RAID 10 needs an even number of drives (mirrored pairs).');

  const warnings: string[] = [];
  let usableDrives: number;
  let guaranteed: number;
  let best: number;
  let description: string;
  switch (level) {
    case '0':
      usableDrives = drives;
      guaranteed = 0;
      best = 0;
      description = 'Striping with no redundancy. Capacity is the sum of all drives; one failed drive loses the whole array.';
      warnings.push('RAID 0 has no redundancy. Keep current backups.');
      break;
    case '1':
      usableDrives = 1;
      guaranteed = drives - 1;
      best = drives - 1;
      description = 'Mirroring. Every drive holds a full copy, so capacity is one drive, and the array survives all but one drive failing.';
      break;
    case '5':
      usableDrives = drives - 1;
      guaranteed = 1;
      best = 1;
      description = 'Single distributed parity. Capacity is all drives minus one; one failure is survivable, but a rebuild stresses the remaining drives.';
      break;
    case '6':
      usableDrives = drives - 2;
      guaranteed = 2;
      best = 2;
      description = 'Dual distributed parity. Capacity is all drives minus two; any two failures are survivable.';
      break;
    case '10':
      usableDrives = drives / 2;
      guaranteed = 1;
      best = drives / 2;
      description = 'Striped mirrors. Capacity is half the drives; one failure is always survivable, and up to one failure per mirrored pair is survivable in the best case.';
      break;
  }

  if (level === '5' && drives > 8) warnings.push('Large RAID 5 sets have long rebuilds and a higher risk of a second failure during rebuild. RAID 6 is usually preferred above about 8 drives.');
  if (level === '6' && drives < 4) warnings.push('RAID 6 needs at least four drives.');

  const rawTb = drives * driveSizeTb;
  const usableTb = usableDrives * driveSizeTb;
  const usableTib = (usableTb * BYTES_PER_TB) / BYTES_PER_TIB;
  return {
    level,
    drives,
    driveSizeTb,
    rawTb: round(rawTb),
    usableTb: round(usableTb),
    usableTib: round(usableTib),
    overheadPct: rawTb === 0 ? 0 : round(((rawTb - usableTb) / rawTb) * 100),
    guaranteedFailures: guaranteed,
    bestCaseFailures: best,
    minDrives,
    description,
    warnings,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const RAID_BYTES = { BYTES_PER_TB, BYTES_PER_TIB };
