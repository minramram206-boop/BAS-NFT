export interface DistrictNetworkConfig {
  network: 'devnet' | 'mainnet-beta';
  rpcUrl: string;
  programId: string;
  collectionMint: string;
  candyMachine: string;
  utilityTokenMint: string;
  tokenBurnRequired: number;
  maxSupply: number;
  treasuryAddress: string;
}

export const DEVNET_CONFIG: DistrictNetworkConfig = {
  network: 'devnet',
  rpcUrl: 'https://api.devnet.solana.com',
  programId: 'BASDistr1ct1111111111111111111111111111111',
  collectionMint: 'BASCo11ect1onDevnet1111111111111111111111111',
  candyMachine: 'BASCandyMach1neDevnet1111111111111111111111',
  utilityTokenMint: 'BASTokenM1rr0rDevnet111111111111111111111111',
  tokenBurnRequired: 1,
  maxSupply: 100,
  treasuryAddress: 'BASTreasuryDevnet11111111111111111111111111'
};

export const MAINNET_CONFIG: DistrictNetworkConfig = {
  network: 'mainnet-beta',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  programId: 'BASDistr1ct1111111111111111111111111111111',
  collectionMint: 'BASCo11ect1onMa1nnet111111111111111111111111',
  candyMachine: 'BASCandyMach1neMa1nnet111111111111111111111',
  utilityTokenMint: 'BASTokenOff1c1alPumpFun11111111111111111111',
  tokenBurnRequired: 1,
  maxSupply: 100,
  treasuryAddress: 'BASTreasuryMa1nnet1111111111111111111111111'
};

export function getNetworkConfig(networkEnv = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet'): DistrictNetworkConfig {
  return networkEnv === 'mainnet-beta' ? MAINNET_CONFIG : DEVNET_CONFIG;
}
