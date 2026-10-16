import type { Metadata, Viewport } from 'next';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import { loadCitizens } from '@bas/content/server';
import { loadDistrictTelemetry } from '@/config/telemetry';
import { DistrictTelemetryProvider } from '@/components/layout/DistrictTelemetryProvider';
import { StudioPlayerProvider } from '@/components/studio/StudioPlayer';
import { WalletDialog } from '@/components/modal/WalletDialog';
import { WalletProvider } from '@/lib/wallet/context';
import { BasStoreProvider } from '@/stores/BasStoreProvider';
import type { ChainOptions } from '@/stores/types';
import { MESSAGES } from '@/messages';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: MESSAGES.metadata.title,
    template: MESSAGES.metadata.titleTemplate,
  },
  description: MESSAGES.metadata.description,
  applicationName: MESSAGES.metadata.applicationName,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c1622',
};

/**
 * `NEXT_PUBLIC_BAS_DATA=chain` runs the district on the cluster in `config/<cluster>.json`;
 * anything else keeps the mock preview. The mission server is `NEXT_PUBLIC_MISSION_SERVER_URL`, the chat server `NEXT_PUBLIC_CHAT_SERVER_URL`.
 */
function chainOptions(telemetry: ReturnType<typeof loadDistrictTelemetry>): ChainOptions | undefined {
  if (process.env.NEXT_PUBLIC_BAS_DATA !== 'chain') return undefined;
  return {
    cluster: telemetry.network === 'devnet' ? 'devnet' : 'mainnet-beta',
    rpcUrl: telemetry.rpcUrl,
    programId: telemetry.programId,
    collection: telemetry.coreCollection,
    candyMachine: telemetry.candyMachine,
    utilityMint: telemetry.utilityTokenMint,
    ...(telemetry.marketProgramId ? { marketProgramId: telemetry.marketProgramId } : {}),
    ...(telemetry.auctionClock ? { auctionClock: telemetry.auctionClock } : {}),
    ...(telemetry.prizeVaultProgramId ? { prizeVaultProgramId: telemetry.prizeVaultProgramId } : {}),
    ...(telemetry.prizeClock ? { prizeClock: telemetry.prizeClock } : {}),
    maxSupply: telemetry.maxSupply,
    missionServerUrl: process.env.NEXT_PUBLIC_MISSION_SERVER_URL ?? 'http://localhost:8787',
    chatServerUrl: process.env.NEXT_PUBLIC_CHAT_SERVER_URL ?? 'http://localhost:8788',
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const citizens = loadCitizens();
  const telemetry = loadDistrictTelemetry();
  const chain = chainOptions(telemetry);

  return (
    <html lang="en">
      <body className="m-0 h-dvh w-screen overflow-hidden bg-[#0c1622] font-pixel text-[#1a2734] antialiased">
        {/*
          Cluster telemetry plus one session store seeded with the validated
          roster. Both live in the layout so progress made in mock mode
          (training, missions) survives navigation between screens.
        */}
        <DistrictTelemetryProvider telemetry={telemetry}>
          <BasStoreProvider
            citizens={citizens}
            trainingConfig={{
              baseTrainingCostAtoms: telemetry.baseTrainingCostAtoms,
              tokenDecimals: telemetry.tokenDecimals,
              tokenSymbol: MESSAGES.app.tokenSymbol,
            }}
            mintPriceLamports={telemetry.mintPriceLamports}
            mintLimitPerWallet={telemetry.mintLimitPerWallet}
            {...(chain ? { chain } : {})}
          >
            {/* BAS Studio's music keeps playing from one screen to the next. */}
            <StudioPlayerProvider>
              {chain ? (
                <WalletProvider cluster={chain.cluster}>
                  {children}
                  <WalletDialog cluster={chain.cluster} />
                </WalletProvider>
              ) : (
                children
              )}
            </StudioPlayerProvider>
          </BasStoreProvider>
        </DistrictTelemetryProvider>
      </body>
    </html>
  );
}
