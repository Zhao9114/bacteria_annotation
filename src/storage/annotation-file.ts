// The annotation file: one image plus the current user's annotation of it,
// opened from the library and saved back automatically. The screen reports
// changes; debouncing, retrying, the document format and timestamps live here.

import { fromDoc, toDoc, type AnnotationContent } from '../io/annotation';
import type { ImageRecord, LibraryStore } from './store';

export type SaveState = 'saved' | 'saving' | 'failed';

export interface AnnotationFileOptions {
  /** Name stamped on the annotation, read at save time. */
  annotator: () => string;
  /** Save this long after the last change. */
  delayMs?: number;
  /** Retry a failed save after this long. */
  retryMs?: number;
  /** Told once when saving starts failing (not on every retry). */
  onError?: (error: Error) => void;
}

export class AnnotationFile {
  /** The newest content not yet handed to storage. */
  private unsaved: AnnotationContent | null = null;
  /** The save in progress, if any. */
  private inflight: Promise<void> | null = null;
  private failed = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private created: string | null;
  private readonly listeners = new Set<(state: SaveState) => void>();
  private readonly delayMs: number;
  private readonly retryMs: number;

  private constructor(
    private readonly library: LibraryStore,
    readonly record: ImageRecord,
    /** The original image file. */
    readonly blob: Blob,
    /** The saved annotation to continue, or null if this user hasn't started one. */
    readonly initial: AnnotationContent | null,
    created: string | null,
    private readonly opts: AnnotationFileOptions,
  ) {
    this.created = created;
    this.delayMs = opts.delayMs ?? 800;
    this.retryMs = opts.retryMs ?? 5000;
  }

  static async open(library: LibraryStore, imageId: string, opts: AnnotationFileOptions): Promise<AnnotationFile> {
    const [{ record, blob }, doc] = await Promise.all([library.getImage(imageId), library.getAnnotation(imageId)]);
    return new AnnotationFile(library, record, blob, doc ? fromDoc(doc) : null, doc?.created ?? null, opts);
  }

  get state(): SaveState {
    return this.failed ? 'failed' : this.pending ? 'saving' : 'saved';
  }

  /** True while a change hasn't reached storage yet. */
  get pending(): boolean {
    return this.unsaved !== null || this.inflight !== null;
  }

  onState(fn: (state: SaveState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The annotation changed; it will be saved shortly. */
  changed(content: AnnotationContent): void {
    if (this.closed) return;
    this.unsaved = content;
    if (!this.failed) this.schedule(this.delayMs);
    this.emit();
  }

  /** Save any pending change now, after a save already in progress. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    while (this.inflight) await this.inflight;
    const content = this.unsaved;
    if (!content) return;
    this.unsaved = null;
    this.inflight = this.save(content);
    this.emit();
    await this.inflight;
  }

  /** Flush, then stop: later changes are ignored. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    clearTimeout(this.timer);
  }

  private async save(content: AnnotationContent): Promise<void> {
    const { filename, sha256, width, height } = this.record;
    try {
      const doc = toDoc(content, { filename, sha256, width, height }, this.opts.annotator(), this.created);
      await this.library.saveAnnotation(this.record.id, doc);
      this.created = doc.created;
      this.failed = false;
    } catch (e) {
      if (!this.failed) this.opts.onError?.(e as Error);
      this.failed = true;
      this.unsaved ??= content; // still needs saving, unless something newer came in
    } finally {
      this.inflight = null;
      // Retry a failure; give changes made while this save was in flight their own save.
      if (this.unsaved && !this.closed) this.schedule(this.failed ? this.retryMs : this.delayMs);
      this.emit();
    }
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
