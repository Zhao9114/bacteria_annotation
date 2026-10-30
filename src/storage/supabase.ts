// Store backed by Supabase: Postgres tables for metadata and annotations,
// a private Storage bucket for the image files. Access rules live in the
// database (supabase/migrations/0001_init.sql), not here.

import { createClient, type SupabaseClient, type User as AuthUser } from '@supabase/supabase-js';
import type { AnnotationDoc, ImageStatus } from '../io/schema';
import type { Account, Auth, ImageRecord, ImageSummary, LibraryScope, LibraryStore, PreparedImage, User } from './store';
import { compareImages } from './store';

const BUCKET = 'images';
const SIGNED_URL_SECONDS = 60 * 60;
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
};

interface ImageRow {
  id: string;
  owner_id: string;
  owner_name: string | null;
  filename: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  storage_path: string;
  thumb_path: string;
  shared: boolean;
  created_at: string;
}

function toRecord(r: ImageRow): ImageRecord {
  return {
    id: r.id,
    owner_id: r.owner_id,
    owner_name: r.owner_name,
    filename: r.filename,
    mime: r.mime,
    width: r.width,
    height: r.height,
    sha256: r.sha256,
    shared: r.shared,
    created: r.created_at,
  };
}

function toUser(u: AuthUser | null | undefined): User | null {
  if (!u) return null;
  // display_name is ours; Google fills in full_name / name.
  const meta = u.user_metadata ?? {};
  const name = [meta.display_name, meta.full_name, meta.name].find((n) => typeof n === 'string' && n.trim()) as
    | string
    | undefined;
  return { id: u.id, email: u.email ?? null, displayName: name?.trim() || null };
}

/** Supabase auth messages, reworded for annotators. */
function authError(message: string): Error {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return new Error('Wrong email or password.');
  if (m.includes('email not confirmed')) return new Error('Please confirm your email first: check your inbox for the link.');
  if (m.includes('already registered')) return new Error('An account with this email already exists. Sign in instead.');
  if (m.includes('password should be')) return new Error('Please choose a password with at least 6 characters.');
  if (m.includes('rate limit')) return new Error('Too many emails were sent recently. Please wait a while and try again.');
  return new Error(message);
}

/** Where Supabase sends people back to after Google or an email link. */
const appUrl = () => location.origin + location.pathname;
const RESET_PARAM = 'reset';

/**
 * Turn a Supabase error result into a thrown Error with a readable message.
 * Note: for maybeSingle() queries the returned data can still be null.
 */
function check<T>(res: { data?: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** One Supabase client plays all three roles: library, account and auth. */
export class SupabaseStore implements LibraryStore, Account, Auth {
  readonly location = 'online';
  readonly canShare = true;
  private user: User | null = null;
  private readonly listeners = new Set<() => void>();
  passwordRecovery = false;

  private constructor(
    private readonly sb: SupabaseClient,
    private readonly url: string,
    private readonly key: string,
  ) {}

  static async create(url: string, anonKey: string): Promise<SupabaseStore> {
    // A password-reset link comes back with ?reset=1 (see sendPasswordReset).
    const params = new URLSearchParams(location.search);
    const recovery = params.has(RESET_PARAM);
    const sb = createClient(url, anonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
    });
    const store = new SupabaseStore(sb, url, anonKey);
    // Resolves after a Google or email-link return has been exchanged for a session.
    const { data } = await sb.auth.getSession();
    store.user = toUser(data.session?.user);
    sb.auth.onAuthStateChange((_event, session) => {
      const before = store.user?.id ?? null;
      store.user = toUser(session?.user);
      // Only when the person changes (sign in / out), not on token refreshes.
      if (before !== (store.user?.id ?? null)) store.emit();
    });
    store.passwordRecovery = recovery && !!store.user;
    if (recovery) {
      params.delete(RESET_PARAM);
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
    }
    return store;
  }

  private uid(): string {
    if (!this.user) throw new Error('Please sign in again.');
    return this.user.id;
  }

  // ---------- auth ----------

  currentUser(): User | null {
    return this.user;
  }

  // The signed-in user is picked up by the onAuthStateChange listener below,
  // which also tells the router to switch screens.

  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw authError(error.message);
  }

  async signUp(name: string, email: string, password: string): Promise<'signed_in' | 'confirm_email'> {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: name }, emailRedirectTo: appUrl() },
    });
    if (error) throw authError(error.message);
    // With email confirmation on, an existing address comes back with no identities
    // (Supabase hides whether the account exists); say so instead of "check your email".
    if (data.user && data.user.identities?.length === 0) throw authError('already registered');
    return data.session ? 'signed_in' : 'confirm_email';
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) throw authError(error.message);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}?${RESET_PARAM}=1` });
    if (error) throw authError(error.message);
  }

  async setPassword(password: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw authError(error.message);
    this.passwordRecovery = false;
  }

  async providers(): Promise<{ google: boolean }> {
    try {
      const res = await fetch(`${this.url}/auth/v1/settings`, { headers: { apikey: this.key } });
      const settings = (await res.json()) as { external?: Record<string, boolean> };
      return { google: !!settings.external?.google };
    } catch {
      return { google: false };
    }
  }

  async signOut(): Promise<void> {
    check(await this.sb.auth.signOut());
  }

  async setDisplayName(name: string): Promise<void> {
    const res = await this.sb.auth.updateUser({ data: { display_name: name } });
    if (res.error) throw new Error(res.error.message);
    this.user = toUser(res.data.user);
    // Keep the name shown on my images' "Shared by" badges current.
    check(await this.sb.from('images').update({ owner_name: name }).eq('owner_id', this.uid()));
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---------- images ----------

  async listImages(scope: LibraryScope): Promise<ImageSummary[]> {
    const uid = this.uid();
    let q = this.sb.from('images').select('*');
    q = scope === 'mine' ? q.eq('owner_id', uid) : q.neq('owner_id', uid).eq('shared', true);
    const rows = check(await q) as ImageRow[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const notes = check(
      await this.sb.from('annotations').select('image_id, status, cell_count').eq('annotator_id', uid).in('image_id', ids),
    ) as { image_id: string; status: ImageStatus; cell_count: number }[];
    const byImage = new Map(notes.map((n) => [n.image_id, n]));

    const signed = check(await this.sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.thumb_path), SIGNED_URL_SECONDS));
    const urls = new Map(signed.map((s) => [s.path, s.signedUrl]));

    return rows
      .map((r) => ({
        ...toRecord(r),
        thumbUrl: urls.get(r.thumb_path) ?? '',
        status: byImage.get(r.id)?.status ?? 'not_started',
        cellCount: byImage.get(r.id)?.cell_count ?? 0,
      }))
      .sort(compareImages);
  }

  async getImage(id: string): Promise<{ record: ImageRecord; blob: Blob }> {
    const row = check(await this.sb.from('images').select('*').eq('id', id).maybeSingle()) as ImageRow | null;
    if (!row) throw new Error('This image does not exist or is no longer shared with you.');
    const blob = check(await this.sb.storage.from(BUCKET).download(row.storage_path));
    return { record: toRecord(row), blob };
  }

  async addImage(img: PreparedImage): Promise<ImageRecord | 'duplicate'> {
    const uid = this.uid();
    const existing = check(
      await this.sb.from('images').select('id').eq('owner_id', uid).eq('sha256', img.sha256).maybeSingle(),
    ) as { id: string } | null;
    if (existing) return 'duplicate';

    const id = crypto.randomUUID();
    const storage_path = `${uid}/${id}.${EXT[img.mime] ?? 'bin'}`;
    const thumb_path = `${uid}/${id}_thumb.jpg`;
    const bucket = this.sb.storage.from(BUCKET);
    check(await bucket.upload(storage_path, img.file, { contentType: img.mime }));
    try {
      check(await bucket.upload(thumb_path, img.thumb, { contentType: 'image/jpeg' }));
      const row = check(
        await this.sb
          .from('images')
          .insert({
            id,
            owner_id: uid,
            owner_name: this.user?.displayName ?? this.user?.email ?? null,
            filename: img.filename,
            mime: img.mime,
            width: img.width,
            height: img.height,
            sha256: img.sha256,
            storage_path,
            thumb_path,
          })
          .select()
          .single(),
      ) as ImageRow;
      return toRecord(row);
    } catch (e) {
      // Don't leave orphaned files behind.
      await bucket.remove([storage_path, thumb_path]);
      throw e;
    }
  }

  async deleteImage(id: string): Promise<void> {
    const row = check(await this.sb.from('images').select('storage_path, thumb_path').eq('id', id).single()) as Pick<
      ImageRow,
      'storage_path' | 'thumb_path'
    >;
    // Deleting the row also deletes everyone's annotations of it (on delete cascade).
    check(await this.sb.from('images').delete().eq('id', id));
    check(await this.sb.storage.from(BUCKET).remove([row.storage_path, row.thumb_path]));
  }

  async setShared(id: string, shared: boolean): Promise<void> {
    check(await this.sb.from('images').update({ shared }).eq('id', id));
  }

  // ---------- annotations ----------

  async getAnnotation(imageId: string): Promise<AnnotationDoc | null> {
    const row = check(
      await this.sb.from('annotations').select('doc').eq('image_id', imageId).eq('annotator_id', this.uid()).maybeSingle(),
    ) as { doc: AnnotationDoc } | null;
    return row?.doc ?? null;
  }

  async saveAnnotation(imageId: string, doc: AnnotationDoc): Promise<void> {
    check(
      await this.sb.from('annotations').upsert(
        {
          image_id: imageId,
          annotator_id: this.uid(),
          annotator_name: doc.annotator,
          status: doc.status,
          cell_count: doc.cells.length,
          doc,
          updated_at: doc.modified,
        },
        { onConflict: 'image_id,annotator_id' },
      ),
    );
  }
}
