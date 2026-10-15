import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CORE_CANDY_GUARD_PROGRAM_ID,
  MINT_LIMIT_ID,
  MPL_CORE_PROGRAM_ID,
  candyGuardAddress,
  mintCounterAddress,
  registerCitizenInstruction,
} from '@bas/chain-client';
import { findCandyGuardPda, findMintCounterPda } from '@metaplex-foundation/mpl-core-candy-machine';
import { publicKey } from '@metaplex-foundation/umi';
import { address } from '@solana/kit';

import { buildMintTransaction } from '../dist/index.js';
import { BLOCKHASH, PROGRAM_ID, TREASURY, offlineUmi, signerOf } from './fixtures.ts';

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const PACKET_LIMIT = 1232;

async function prepare(overrides: { minter?: string } = {}) {
  const umi = offlineUmi();
  const candyMachine = signerOf(umi, 'machine').publicKey;
  const collection = signerOf(umi, 'collection').publicKey;
  const asset = signerOf(umi, 'asset');
  const mintSigner = signerOf(umi, 'mint-signer');
  const minter = overrides.minter ?? signerOf(umi, 'wallet').publicKey;
  const register = await registerCitizenInstruction({
    programId: address(PROGRAM_ID),
    owner: address(minter),
    asset: address(asset.publicKey),
    approvedTemplateId: 7,
  });
  const prepared = await buildMintTransaction(umi, {
    candyMachine,
    collection,
    minter,
    asset,
    mintSigner,
    treasury: TREASURY,
    mintLimitId: MINT_LIMIT_ID,
    register,
    computeUnitLimit: 400_000,
    blockhash: BLOCKHASH,
  });
  const message = umi.transactions.deserialize(prepared.transaction).message;
  return { umi, prepared, message, candyMachine, collection, asset, mintSigner, minter };
}

describe('mint transaction', () => {
  it('runs the compute budget, the Candy Guard mint and register_citizen, in that order', async () => {
    const { message } = await prepare();
    const programs = message.instructions.map((instruction) => message.accounts[instruction.programIndex]);
    assert.deepEqual(programs, [COMPUTE_BUDGET, CORE_CANDY_GUARD_PROGRAM_ID, PROGRAM_ID]);
  });

  it('registers the asset it mints, for the wallet that mints it', async () => {
    const { message, asset, minter } = await prepare();
    const register = message.instructions[2];
    assert.ok(register);
    const accounts = register.accountIndexes.map((index) => String(message.accounts[index]));
    assert.equal(accounts[1], asset.publicKey);
    assert.equal(accounts[4], minter);
  });

  it('hands the guard the collection, the minter, the asset and the Core program', async () => {
    const { message, asset, collection, minter, candyMachine } = await prepare();
    const mint = message.instructions[1];
    assert.ok(mint);
    const accounts = mint.accountIndexes.map((index) => String(message.accounts[index]));
    assert.equal(accounts[0], findCandyGuardPda(offlineUmi(), { base: publicKey(candyMachine) })[0]);
    assert.ok(accounts.includes(asset.publicKey));
    assert.ok(accounts.includes(collection));
    assert.ok(accounts.includes(minter));
    assert.ok(accounts.includes(MPL_CORE_PROGRAM_ID));
  });

  it('points the mint limit at the counter the chain reader derives', async () => {
    const { message, umi, candyMachine, minter } = await prepare();
    const guard = await candyGuardAddress(address(candyMachine));
    const counter = await mintCounterAddress({
      id: 0,
      user: address(minter),
      candyMachine: address(candyMachine),
      candyGuard: guard,
    });
    // The SDK and the browser-safe derivation must agree, or the page would read the wrong account.
    const viaSdk = findMintCounterPda(umi, {
      id: 0,
      user: publicKey(minter),
      candyMachine: publicKey(candyMachine),
      candyGuard: publicKey(guard),
    })[0];
    assert.equal(counter, viaSdk);
    const mint = message.instructions[1];
    assert.ok(mint);
    assert.ok(mint.accountIndexes.map((index) => String(message.accounts[index])).includes(counter));
  });

  it('pays the treasury and the backend signer is a required signer', async () => {
    const { message, mintSigner, asset, minter } = await prepare();
    assert.ok(message.accounts.slice(0, message.header.numRequiredSignatures).includes(mintSigner.publicKey));
    assert.deepEqual(message.accounts.slice(0, message.header.numRequiredSignatures).sort(), [asset.publicKey, mintSigner.publicKey, minter].sort());
    assert.ok(message.accounts.includes(TREASURY));
  });

  it('leaves exactly the minter unsigned and fits one packet', async () => {
    const { prepared, message, minter } = await prepare();
    const umi = offlineUmi();
    const signed = umi.transactions.deserialize(prepared.transaction);
    const blank = message.accounts
      .slice(0, message.header.numRequiredSignatures)
      .filter((_, index) => signed.signatures[index]?.every((byte) => byte === 0));
    assert.deepEqual(blank, [minter]);
    assert.ok(prepared.transaction.length <= PACKET_LIMIT, `transaction is ${prepared.transaction.length} bytes`);
    assert.equal(prepared.blockhash, BLOCKHASH.blockhash);
    assert.equal(prepared.lastValidBlockHeight, BLOCKHASH.lastValidBlockHeight);
  });

  it('refuses a minter that is also one of the server signers', async () => {
    const umi = offlineUmi();
    await assert.rejects(prepare({ minter: signerOf(umi, 'mint-signer').publicKey }), /different key/);
    await assert.rejects(prepare({ minter: signerOf(umi, 'asset').publicKey }), /different key/);
  });
});
