// What the screens need from a backend, split at its real seams:
//   LibraryStore - images, videos and annotations  adapters: IndexedDB (local.ts), Supabase (supabase.ts)
//   Account      - who is annotating, by name adapters: this browser (local.ts), Supabase user
//   Auth         - signing in                 adapter:  Supabase only; the browser-only build has none

import type { AnnotationDoc, ImageStatus } from '../io/schema';

export interface User {
  id: string;
  email: string | null;
  /** Shown as the annotator; null until the user has chosen one. */
  displayName: string | null;
}

/** How a saved frame was chosen: automatically by one of the pick methods, or by hand. */
export type FramePick = 'random' | 'even' | 'sharpest' | 'manual';

/** Where an image came from when it is a frame saved from a video. */
export interface FrameSource {
  video_id: string;
  /** Frame number in display order, from 0 (the same numbering OpenCV uses). */
  index: number;
  /** Seconds from the start of the video. */
  time: number;
  /** How it was chosen; null for frames saved before this was recorded. */
  picked_by: FramePick | null;
  /** Focus score (variance of the Laplacian); only comparable within the same video. */
  sharpness: number | null;
  /** Percentile of that score among the video's frames: 0 = blurriest, 100 = sharpest. */
  sharpness_pct: number | null;
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
  /** Set when this image is a frame saved from a video. */
  frame: FrameSource | null;
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
  frame: FrameSource | null;
}

/** A video that frames were picked from. The video file itself isn't stored. */
export interface VideoRecord {
  id: string;
  owner_id: string;
  owner_name: string | null;
  filename: string;
  /** Hash of the video file, to recognise it when it is added again. */
  sha256: string;
  /** Phone that recorded it, e.g. "iPhone 14 Pro". */
  phone: string;
  /** The phone sensor's pixel size in µm, as reported. Not a scale on the specimen. */
  pixel_size_um: number | null;
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  /** Seconds. */
  duration: number;
  /** Shares every frame of the video (Supabase only). */
  shared: boolean;
  created: string;
}

export interface VideoSummary extends VideoRecord {
  /** Thumbnail of the first saved frame; '' while none is saved. */
  thumbUrl: string;
  /** Saved frames; how many of them the current user has started and marked done. */
  frames: number;
  started: number;
  done: number;
}

/** A video's overall status for the current user, from its frames' statuses. */
export function videoStatus(v: Pick<VideoSummary, 'frames' | 'started' | 'done'>): ImageStatus {
  if (v.frames > 0 && v.done === v.frames) return 'done';
  return v.started > 0 ? 'in_progress' : 'not_started';
}

export type PreparedVideo = Pick<
  VideoRecord,
  'filename' | 'sha256' | 'phone' | 'pixel_size_um' | 'width' | 'height' | 'fps' | 'frame_count' | 'duration'
>;
export type VideoChange = Partial<Pick<VideoRecord, 'phone' | 'pixel_size_um'>>;

/** 'mine' = images I own; 'shared' = other people's images shared with everyone. */
export type LibraryScope = 'mine' | 'shared';

/** Images, videos and the current user's annotations of them. */
export interface LibraryStore {
  /** Where the data lives, for the "Saved in this browser" / "Saved online" labels. */
  readonly location: 'browser' | 'online';
  /** Images can be shared with other signed-in users (online only). */
  readonly canShare: boolean;

  /** Images that are not video frames (those are listed per video). */
  listImages(scope: LibraryScope): Promise<ImageSummary[]>;
  getImage(id: string): Promise<{ record: ImageRecord; blob: Blob }>;
  /** Returns 'duplicate' if the same image (by SHA-256) is already in my library. */
  addImage(image: PreparedImage): Promise<ImageRecord | 'duplicate'>;
  deleteImage(id: string): Promise<void>;
  /** Only when `canShare`. */
  setShared(id: string, shared: boolean): Promise<void>;

  listVideos(scope: LibraryScope): Promise<VideoSummary[]>;
  getVideo(id: string): Promise<VideoRecord>;
  /** My video with this hash, if I have added it before. */
  findVideo(sha256: string): Promise<VideoRecord | null>;
  addVideo(video: PreparedVideo): Promise<VideoRecord>;
  updateVideo(id: string, change: VideoChange): Promise<void>;
  /** Deletes the video, its frames and everyone's annotations of them. */
  deleteVideo(id: string): Promise<void>;
  /** Shares or unshares the video with all its frames. Only when `canShare`. */
  setVideoShared(id: string, shared: boolean): Promise<void>;
  /** A video's saved frames, in frame order. */
  listFrames(videoId: string): Promise<ImageSummary[]>;

  /** The current user's annotation of an image. */
  getAnnotation(imageId: string): Promise<AnnotationDoc | null>;
  saveAnnotation(imageId: string, doc: AnnotationDoc): Promise<void>;
}

/** Who is annotating: the name stamped on annotations. */
export interface Account {
  /** Null only when nobody is signed in (online version). */
  currentUser(): User | null;
  setDisplayName(name: string): Promise<void>;
  /** Called when the person or their name changes. */
  onChange(fn: () => void): () => void;
}

/** Signing in and out. Only the online version has one. */
export interface Auth {
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
  providers(): Promise<{ google: boolean }>;
  signOut(): Promise<void>;
}

/** Everything the app runs on. `auth` is null in the browser-only version. */
export interface Backend {
  library: LibraryStore;
  account: Account;
  auth: Auth | null;
}

/**
 * Library order, also used for previous/next navigation: frames of a video in
 * frame order, everything else by filename with numbers in natural order.
 */
export function compareImages(a: ImageRecord, b: ImageRecord): number {
  if (a.frame && b.frame && a.frame.video_id === b.frame.video_id) return a.frame.index - b.frame.index;
  return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

/** Video order in the library: by phone, then file name. */
export function compareVideos(a: VideoRecord, b: VideoRecord): number {
  return (
    a.phone.localeCompare(b.phone, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  );
}
