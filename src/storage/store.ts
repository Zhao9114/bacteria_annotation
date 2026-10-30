// The storage interface the screens use. Two implementations:
//   local.ts    - IndexedDB in this browser (used when Supabase isn't configured)
//   supabase.ts - Supabase Postgres + Storage, with sign-in and sharing

import type { AnnotationDoc, ImageStatus } from '../io/schema';

export interface User {
  id: string;
  email: string | null;
  /** Shown as the annotator; null until the user has chosen one. */
  displayName: string | null;
}

export interface ImageRecord {
  id: string;
  owner_id: string;
  /** Display name of the owner, for "Shared by …" badges. */
  owner_name: string | null;
  filename: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  /** Visible to every signed-in user (Supabase only). */
  shared: boolean;
  created: string;
}

export interface ImageSummary extends ImageRecord {
  thumbUrl: string;
  /** The current user's annotation status and cell count for this image. */
  status: ImageStatus;
  cellCount: number;
}

/** What the browser computes before an upload (see upload.ts). */
export interface PreparedImage {
  file: Blob;
  filename: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  thumb: Blob;
}

/** 'mine' = images I own; 'shared' = other people's images shared with everyone. */
export type LibraryScope = 'mine' | 'shared';

export interface Store {
  readonly kind: 'local' | 'supabase';

  currentUser(): User | null;
  signInWithPassword(email: string, password: string): Promise<void>;
  /** 'confirm_email' when the project requires confirming the address before the first sign-in. */
  signUp(name: string, email: string, password: string): Promise<'signed_in' | 'confirm_email'>;
  /** Redirects the browser to Google and back. */
  signInWithGoogle(): Promise<void>;
  /** Emails a link that brings the user back to choose a new password. */
  sendPasswordReset(email: string): Promise<void>;
  setPassword(password: string): Promise<void>;
  /** True right after arriving from a password-reset link. */
  readonly passwordRecovery: boolean;
  /** Which optional sign-in methods are switched on for this project. */
  authProviders(): Promise<{ google: boolean }>;
  signOut(): Promise<void>;
  setDisplayName(name: string): Promise<void>;
  onAuthChange(fn: () => void): () => void;

  listImages(scope: LibraryScope): Promise<ImageSummary[]>;
  getImage(id: string): Promise<{ record: ImageRecord; blob: Blob }>;
  /** Returns 'duplicate' if the same image (by SHA-256) is already in my library. */
  addImage(image: PreparedImage): Promise<ImageRecord | 'duplicate'>;
  deleteImage(id: string): Promise<void>;
  setShared(id: string, shared: boolean): Promise<void>;

  /** The current user's annotation of an image. */
  getAnnotation(imageId: string): Promise<AnnotationDoc | null>;
  saveAnnotation(imageId: string, doc: AnnotationDoc): Promise<void>;
}

/** Library order, also used for previous/next navigation: by filename, numbers in natural order. */
export function compareImages(a: ImageRecord, b: ImageRecord): number {
  return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
}
