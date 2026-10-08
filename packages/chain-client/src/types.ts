export type StatType = 'intelligence' | 'alignment' | 'composure';

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

export interface TrainingReceipt {
  signature: string;
  statUpgraded: StatType;
  newScore: number;
  tokensBurned: number;
  timestamp: number;
}

export interface MintResult {
  signature: string;
  assetAddress: string;
  citizenId: number;
}
