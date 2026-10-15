import type { CitizenContext } from '@bas/ai';
import { ROLE_TEMPLATES } from '@bas/chain-client';
import type { CitizenRecord } from '@bas/content';
import type { CitizenAssets } from '@bas/server-kit';

/** An official citizen: who holds it right now, and what the model may know about it. */
export interface ResolvedCitizen {
  readonly owner: string;
  readonly citizen: CitizenContext;
}

export interface CitizenDirectory {
  /** `null` when the asset is not an official, registered citizen. */
  resolve(asset: string): Promise<ResolvedCitizen | null>;
}

/**
 * Joins the chain (holder, role, scores) with the authored roster (name, lore).
 * The chain decides everything that can change hands or grow; the roster only
 * supplies the words. The roster entry is found by the number in the asset's
 * metadata file name, the same way the web app does it.
 */
export function createCitizenDirectory(reader: CitizenAssets, roster: readonly CitizenRecord[]): CitizenDirectory {
  const byId = new Map(roster.map((record) => [record.id, record]));
  return {
    async resolve(asset) {
      const [info, state] = await Promise.all([reader.assetInfo(asset), reader.citizen(asset)]);
      if (!info || !state || info.serial === null) return null;
      const owner = info.owner;
      const record = byId.get(info.serial);
      const role = ROLE_TEMPLATES.find((template) => template.index === state.role);
      if (!record || !role) return null;
      return {
        owner,
        citizen: {
          asset,
          name: record.name,
          roleKey: role.key,
          role: role.label,
          lore: record.lore,
          scores: state.scores,
        },
      };
    },
  };
}
