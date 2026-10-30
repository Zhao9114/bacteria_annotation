// Picks the backend: Supabase when it is configured at build time
// (VITE_SUPABASE_URL plus VITE_SUPABASE_PUBLISHABLE_KEY, or the older
// VITE_SUPABASE_ANON_KEY), otherwise this browser only.

import { LocalAccount, LocalStore } from './local';
import type { Backend } from './store';

export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
    | string
    | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

export async function createBackend(): Promise<Backend> {
  const cfg = supabaseConfig();
  if (cfg) {
    // Loaded on demand so the browser-only build doesn't download the Supabase client.
    const { SupabaseStore } = await import('./supabase');
    const sb = await SupabaseStore.create(cfg.url, cfg.anonKey);
    return { library: sb, account: sb, auth: sb };
  }
  return { library: await LocalStore.open(), account: new LocalAccount(), auth: null };
}
