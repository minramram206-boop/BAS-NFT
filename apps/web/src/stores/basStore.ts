import { createStore, useStore, type StoreApi } from 'zustand';
import { createChatSlice } from './slices/chatSlice';
import { createCitySlice } from './slices/citySlice';
import { createDistrictSlice } from './slices/districtSlice';
import { createUiSlice } from './slices/uiSlice';
import type { BasStore, CreateBasStoreOptions } from './types';

export type { BasStore, CityMode, CreateBasStoreOptions, ModalState, TrainingConfig } from './types';

export type BasStoreApi = StoreApi<BasStore>;

/** One store per page load, composed from the district, city, UI and chat slices. */
export function createBasStore(options: CreateBasStoreOptions): BasStoreApi {
  return createStore<BasStore>()((set, get) => ({
    ...createDistrictSlice(options, set, get),
    ...createCitySlice(set, get),
    ...createUiSlice(set, get),
    ...createChatSlice(set, get),
  }));
}

/** Read one slice of the store. Use through the hooks in `stores/selectors.ts`. */
export function useBasStoreSlice<T>(api: BasStoreApi, selector: (state: BasStore) => T): T {
  return useStore(api, selector);
}
