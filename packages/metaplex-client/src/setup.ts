import { addConfigLines, create, updateCandyGuard } from '@metaplex-foundation/mpl-core-candy-machine';
import { publicKey, some, type Signer, type TransactionBuilder, type Umi } from '@metaplex-foundation/umi';
import { guardSetFor, type SaleGuardSettings } from './guards.js';

/** One citizen of the sale: the name and the metadata file the asset starts with. */
export interface SaleItem {
  /** Asset name, for example `Farmer Hale #001`. */
  readonly name: string;
  /** Metadata file under the approved template prefix, for example `001-artisan.json`. */
  readonly file: string;
}

export interface CreateSaleInput {
  /** Fresh keypair that becomes the Candy Machine address. */
  readonly candyMachine: Signer;
  readonly collection: string;
  /** Update authority of the collection; it approves the machine as a delegate. */
  readonly collectionUpdateAuthority: Signer;
  /** `approvedTemplateUriPrefix` of the manifest: the program only accepts assets whose URI starts with it. */
  readonly uriPrefix: string;
  readonly items: readonly SaleItem[];
  readonly guards: SaleGuardSettings;
}

const MAX_NAME_LENGTH = 32;

/** Lines per `addConfigLines` transaction; sized so a line pair fits a legacy transaction with room to spare. */
export const CONFIG_LINES_PER_TRANSACTION = 10;

function uriLengthOf(items: readonly SaleItem[]): number {
  return items.reduce((longest, item) => Math.max(longest, item.file.length), 0);
}

/**
 * Creates the Candy Machine and its guard and wraps one around the other
 * (`create`, `createCandyGuard`, `wrap`). Items are added afterwards with
 * `buildAddItems`; the machine cannot mint before every one is in.
 *
 * Items are handed out in a shuffled order (`isSequential: false`), so the role
 * a buyer gets is the draw of the machine (SPEC §6).
 */
export async function buildCreateSale(umi: Umi, input: CreateSaleInput): Promise<TransactionBuilder> {
  const { items, uriPrefix } = input;
  if (items.length === 0) throw new Error('a sale needs at least one item');
  if (!/^https:\/\/.+\/$/.test(uriPrefix)) throw new Error(`the metadata prefix must be an https URL ending in "/": ${uriPrefix}`);
  for (const item of items) {
    if (item.name.length === 0 || item.name.length > MAX_NAME_LENGTH) {
      throw new Error(`"${item.name}" is not a name of 1 to ${MAX_NAME_LENGTH} characters`);
    }
  }
  return create(umi, {
    candyMachine: input.candyMachine,
    collection: publicKey(input.collection),
    collectionUpdateAuthority: input.collectionUpdateAuthority,
    itemsAvailable: items.length,
    isMutable: false,
    configLineSettings: some({
      prefixName: '',
      nameLength: MAX_NAME_LENGTH,
      prefixUri: uriPrefix,
      uriLength: uriLengthOf(items),
      isSequential: false,
    }),
    guards: guardSetFor(input.guards),
  });
}

/** Updates an existing Candy Guard's guard set in place. */
export function buildUpdateSaleGuards(
  umi: Umi,
  input: { readonly candyGuard: string; readonly authority: Signer; readonly guards: SaleGuardSettings },
): TransactionBuilder {
  return updateCandyGuard(umi, {
    candyGuard: publicKey(input.candyGuard),
    authority: input.authority,
    guards: guardSetFor(input.guards),
    groups: [],
  });
}

/**
 * `addConfigLines` transactions that load the items, `CONFIG_LINES_PER_TRANSACTION` at a time.
 * `loaded` is how many the machine already holds, so an interrupted setup resumes where it stopped.
 */
export function buildAddItems(
  umi: Umi,
  candyMachine: string,
  items: readonly SaleItem[],
  loaded = 0,
): TransactionBuilder[] {
  if (!Number.isInteger(loaded) || loaded < 0 || loaded > items.length) {
    throw new Error(`${loaded} items are loaded but the sale has ${items.length}`);
  }
  const builders: TransactionBuilder[] = [];
  for (let index = loaded; index < items.length; index += CONFIG_LINES_PER_TRANSACTION) {
    builders.push(
      addConfigLines(umi, {
        candyMachine: publicKey(candyMachine),
        index,
        configLines: items.slice(index, index + CONFIG_LINES_PER_TRANSACTION).map((item) => ({ name: item.name, uri: item.file })),
      }),
    );
  }
  return builders;
}
