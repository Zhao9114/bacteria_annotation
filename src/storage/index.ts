// Picks the storage backend. Only the browser (IndexedDB) backend exists so far.

import { LocalStore } from './local';
import type { Store } from './store';

export async function createStore(): Promise<Store> {
  return LocalStore.open();
}
