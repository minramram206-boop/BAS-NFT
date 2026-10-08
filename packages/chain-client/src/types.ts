/** Trainable citizen stat. Mirrors `CitizenStat` in `programs/district`. */
export type StatType = 'intelligence' | 'alignment' | 'composure';

export const STAT_TYPES: readonly StatType[] = ['intelligence', 'alignment', 'composure'];

export function isStatType(value: unknown): value is StatType {
  return typeof value === 'string' && (STAT_TYPES as readonly string[]).includes(value);
}

/** Canonical citizen progression state as stored by the District program. */
export interface CitizenStateOnChain {
  asset: string;
  owner: string;
  name: string;
  code: string;
  roleKey: string;
  intelligence: number;
  alignment: number;
  composure: number;
  trainingCredits: number;
  totalBurns: number;
  lastTrainedSlot: number;
}

/** Receipt returned after one atomic training transaction. */
export interface TrainingReceipt {
  signature: string;
  statUpgraded: StatType;
  newScore: number;
  tokensBurned: number;
  timestamp: number;
}

/** Receipt returned after one successful citizen mint. */
export interface MintResult {
  signature: string;
  assetAddress: string;
  citizenId: number;
}
