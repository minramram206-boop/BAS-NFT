/**
 * Lists what still keeps config/mainnet.json from launching: repository
 * placeholders, and anything copied from the devnet tests (program ids,
 * wallets, collection, RPC, metadata origin). Exits 1 while the list is not
 * empty. The servers and the web build run the same check on mainnet.
 *
 *   pnpm mainnet:check
 */
// The built package, as the other root scripts load theirs; `pnpm install` builds it.
const { MAINNET_CONFIG, findPlaceholderConfiguration } = await import(new URL('../packages/config/dist/index.js', import.meta.url).href);

const problems = findPlaceholderConfiguration(MAINNET_CONFIG);
if (problems.length === 0) {
  console.log('config/mainnet.json is launch ready.');
} else {
  console.log(`config/mainnet.json is not launch ready (${problems.length}):`);
  for (const { field, value, reason } of problems) console.log(`  ${field.padEnd(26)} ${value}  ${reason}`);
  process.exitCode = 1;
}
