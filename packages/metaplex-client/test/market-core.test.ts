import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coreAddPluginInstruction,
  coreAddTransferDelegateInstruction,
  coreApprovePluginInstruction,
  coreApproveTransferDelegateInstruction,
  coreRevokePluginInstruction,
  coreRevokeTransferDelegateInstruction,
} from '@bas/chain-client';
import {
  PluginType,
  addPluginV1,
  approvePluginAuthorityV1,
  revokePluginAuthorityV1,
} from '@metaplex-foundation/mpl-core';
import { createNoopSigner, publicKey, type Instruction as UmiInstruction } from '@metaplex-foundation/umi';
import { address, isSignerRole, isWritableRole, type Instruction } from '@solana/kit';

import { offlineUmi } from './fixtures.ts';

/**
 * The Core plugin instructions `@bas/chain-client` builds by hand, byte for
 * byte against Core's own client. The web app cannot pull in Umi, so this is
 * where the two meet.
 */

const ASSET = 'A6kLyjEaWi5pzdc46MnVd1WeKgFabjWVUREJw8f8rbhn';
const COLLECTION = '7Cxz7FfrZ5cAeZruPU8wN9fdti4Y97DJgw3y3kXw4jDa';
const OWNER = 'FLagggahkgNjgzjXKKsXECvPZdLXGtfmUgPuZYKnconk';
const DELEGATE = '9DfhjiWco7mDjyiwwSZo9UtyAYqYhjxSw3GyfTmCGEuK';

const ours = { asset: address(ASSET), collection: address(COLLECTION), owner: address(OWNER), delegate: address(DELEGATE) };
const theirs = {
  asset: publicKey(ASSET),
  collection: publicKey(COLLECTION),
  payer: createNoopSigner(publicKey(OWNER)),
  authority: createNoopSigner(publicKey(OWNER)),
};

function same(mine: Instruction, official: UmiInstruction): void {
  assert.equal(mine.programAddress, official.programId);
  assert.deepEqual([...(mine.data ?? [])], [...official.data]);
  assert.deepEqual(
    (mine.accounts ?? []).map((account) => [account.address, isSignerRole(account.role), isWritableRole(account.role)]),
    official.keys.map((key) => [key.pubkey, key.isSigner, key.isWritable]),
  );
}

const only = (builder: { getInstructions(): UmiInstruction[] }): UmiInstruction => {
  const [instruction, ...rest] = builder.getInstructions();
  assert.ok(instruction && rest.length === 0);
  return instruction;
};

describe('Core plugin instructions for the market', () => {
  const umi = offlineUmi();

  it('AddPluginV1 with a TransferDelegate for the market', () => {
    same(
      coreAddTransferDelegateInstruction(ours),
      only(
        addPluginV1(umi, {
          ...theirs,
          plugin: { __kind: 'TransferDelegate', fields: [{}] },
          initAuthority: { __kind: 'Address', address: publicKey(DELEGATE) },
        }),
      ),
    );
  });

  it('ApprovePluginAuthorityV1 on the TransferDelegate', () => {
    same(
      coreApproveTransferDelegateInstruction(ours),
      only(
        approvePluginAuthorityV1(umi, {
          ...theirs,
          pluginType: PluginType.TransferDelegate,
          newAuthority: { __kind: 'Address', address: publicKey(DELEGATE) },
        }),
      ),
    );
  });

  it('RevokePluginAuthorityV1 on the TransferDelegate', () => {
    same(coreRevokeTransferDelegateInstruction(ours), only(revokePluginAuthorityV1(umi, { ...theirs, pluginType: PluginType.TransferDelegate })));
  });
});

describe('Core FreezeDelegate instructions for auctions', () => {
  const umi = offlineUmi();

  it('AddPluginV1 with an unfrozen FreezeDelegate for the market', () => {
    same(
      coreAddPluginInstruction({ ...ours, plugin: 'freezeDelegate' }),
      only(
        addPluginV1(umi, {
          ...theirs,
          plugin: { __kind: 'FreezeDelegate', fields: [{ frozen: false }] },
          initAuthority: { __kind: 'Address', address: publicKey(DELEGATE) },
        }),
      ),
    );
  });

  it('ApprovePluginAuthorityV1 and RevokePluginAuthorityV1 on the FreezeDelegate', () => {
    same(
      coreApprovePluginInstruction({ ...ours, plugin: 'freezeDelegate' }),
      only(
        approvePluginAuthorityV1(umi, {
          ...theirs,
          pluginType: PluginType.FreezeDelegate,
          newAuthority: { __kind: 'Address', address: publicKey(DELEGATE) },
        }),
      ),
    );
    same(coreRevokePluginInstruction({ ...ours, plugin: 'freezeDelegate' }), only(revokePluginAuthorityV1(umi, { ...theirs, pluginType: PluginType.FreezeDelegate })));
  });
});

