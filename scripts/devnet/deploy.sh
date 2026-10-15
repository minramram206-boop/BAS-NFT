#!/usr/bin/env bash
# Deploys target/deploy/<program>.so to devnet with the program keypair in
# programs/<program>/keypair.json, paid for and owned by the deployer key.
# PROGRAM is district unless set. Run from the repository root in WSL or
# Linux. See docs/id/DEVNET_DEPLOY_ID.md and docs/MARKET.md. Running it again
# upgrades the program, extending its data account first when the binary grew.
#
#   bash scripts/devnet/deploy.sh [rpc-url]
#   PROGRAM=market bash scripts/devnet/deploy.sh [rpc-url]
set -euo pipefail

RPC_URL="${1:-https://api.devnet.solana.com}"
DEPLOYER="${DEPLOYER_KEYPAIR:-.keys/devnet-deployer.json}"
PROGRAM="${PROGRAM:-district}"
case "$PROGRAM" in
  district | market) ;;
  *)
    echo "Unknown PROGRAM $PROGRAM (expected district or market)" >&2
    exit 1
    ;;
esac
PROGRAM_KEYPAIR="programs/$PROGRAM/keypair.json"
PROGRAM_SO="target/deploy/$PROGRAM.so"

for file in "$DEPLOYER" "$PROGRAM_KEYPAIR" "$PROGRAM_SO"; do
  if [ ! -f "$file" ]; then
    echo "Missing $file" >&2
    exit 1
  fi
done

program_id="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
declared="$(sed -n 's/^declare_id!("\(.*\)");$/\1/p' "programs/$PROGRAM/src/lib.rs")"
if [ "$program_id" != "$declared" ]; then
  echo "Program keypair $program_id does not match declare_id! $declared" >&2
  exit 1
fi

# A market built with the `devnet-clock` feature runs auctions in minutes.
# That binary may only go to devnet, and only while config/devnet.json names
# the same clock, or the web app would show the wrong auction lengths. The
# binary carries a log line only that build has, which is what is checked here.
if [ "$PROGRAM" = market ]; then
  devnet_genesis="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  manifest_clock=real
  if grep -q '"auctionClock": *"devnet-fast"' config/devnet.json; then manifest_clock=devnet-fast; fi
  if grep -qa "BAS devnet auction clock" "$PROGRAM_SO"; then
    if [ "$(solana genesis-hash --url "$RPC_URL")" != "$devnet_genesis" ]; then
      echo "This market binary runs the fast devnet auction clock; $RPC_URL is not devnet." >&2
      echo "Build the real one with: cargo build-sbf --manifest-path programs/market/Cargo.toml" >&2
      exit 1
    fi
    if [ "$manifest_clock" != "devnet-fast" ]; then
      echo "This market binary runs the fast devnet auction clock, but config/devnet.json has no \"auctionClock\": \"devnet-fast\"." >&2
      exit 1
    fi
    echo "Auctions: fast devnet clock (one auction hour lasts 10 seconds)"
  else
    if [ "$manifest_clock" = "devnet-fast" ]; then
      echo "config/devnet.json says \"auctionClock\": \"devnet-fast\", but this market binary runs the real clock." >&2
      echo "Build it with: cargo build-sbf --manifest-path programs/market/Cargo.toml --features devnet-clock" >&2
      echo "(or remove auctionClock from the manifest)" >&2
      exit 1
    fi
    echo "Auctions: real clock"
  fi
fi

echo "Deployer: $(solana-keygen pubkey "$DEPLOYER")"
echo "Balance:  $(solana balance --url "$RPC_URL" --keypair "$DEPLOYER")"
echo "Program:  $program_id"

# An upgrade needs ProgramData at least as large as the new binary. The
# account is sized at first deploy, so a binary that grew is room short.
so_bytes="$(stat -c %s "$PROGRAM_SO")"
data_bytes="$(solana program show "$program_id" --url "$RPC_URL" 2>/dev/null | sed -n 's/^Data Length: \([0-9]*\).*/\1/p')"
if [ -n "$data_bytes" ] && [ "$so_bytes" -gt "$data_bytes" ]; then
  extra=$((so_bytes - data_bytes))
  # The loader refuses to extend by less than 10,240 bytes at a time, so a
  # binary that grew only a little still gets that much room.
  min_extend=10240
  if [ "$extra" -lt "$min_extend" ]; then extra=$min_extend; fi
  echo "Extending program data by $extra bytes ($data_bytes -> $((data_bytes + extra)), binary $so_bytes)"
  solana program extend "$program_id" "$extra" \
    --keypair "$DEPLOYER" \
    --url "$RPC_URL"
fi

solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$DEPLOYER" \
  --upgrade-authority "$DEPLOYER" \
  --url "$RPC_URL"

solana program show "$program_id" --url "$RPC_URL"
