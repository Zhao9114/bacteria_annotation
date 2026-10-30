// Picks the storage backend: Supabase when it is configured at build time
// (VITE_SUPABASE_URL plus VITE_SUPABASE_PUBLISHABLE_KEY, or the older
// VITE_SUPABASE_ANON_KEY), otherwise IndexedDB in this browser.

import { LocalStore } from './local';
import type { Store } from './store';

export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
    | string
    | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

export async function createStore(): Promise<Store> {
  const cfg = supabaseConfig();
  if (cfg) {
    // Loaded on demand so the local-only build doesn't download the Supabase client.
    const { SupabaseStore } = await import('./supabase');
    return SupabaseStore.create(cfg.url, cfg.anonKey);
  }
  return LocalStore.open();
}
