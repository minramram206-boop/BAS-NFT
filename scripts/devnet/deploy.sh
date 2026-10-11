#!/usr/bin/env bash
# Deploys target/deploy/district.so to devnet with the program keypair in
# programs/district/keypair.json, paid for and owned by the deployer key.
# Run from the repository root in WSL or Linux. See docs/id/DEVNET_DEPLOY_ID.md.
#
#   bash scripts/devnet/deploy.sh [rpc-url]
set -euo pipefail

RPC_URL="${1:-https://api.devnet.solana.com}"
DEPLOYER="${DEPLOYER_KEYPAIR:-.keys/devnet-deployer.json}"
PROGRAM_KEYPAIR="programs/district/keypair.json"
PROGRAM_SO="target/deploy/district.so"

for file in "$DEPLOYER" "$PROGRAM_KEYPAIR" "$PROGRAM_SO"; do
  if [ ! -f "$file" ]; then
    echo "Missing $file" >&2
    exit 1
  fi
done

program_id="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
declared="$(sed -n 's/^declare_id!("\(.*\)");$/\1/p' programs/district/src/lib.rs)"
if [ "$program_id" != "$declared" ]; then
  echo "Program keypair $program_id does not match declare_id! $declared" >&2
  exit 1
fi

echo "Deployer: $(solana-keygen pubkey "$DEPLOYER")"
echo "Balance:  $(solana balance --url "$RPC_URL" --keypair "$DEPLOYER")"
echo "Program:  $program_id"

solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$DEPLOYER" \
  --upgrade-authority "$DEPLOYER" \
  --url "$RPC_URL"

solana program show "$program_id" --url "$RPC_URL"
