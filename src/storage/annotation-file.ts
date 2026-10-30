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
  private latest: AnnotationContent | null = null;
  private dirty = false;
  private saving = false;
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
    readonly initial: (AnnotationContent & { nextCellId: number }) | null,
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
    return this.failed ? 'failed' : this.saving || this.dirty ? 'saving' : 'saved';
  }

  /** True while a change hasn't reached storage yet. */
  get pending(): boolean {
    return this.dirty || this.saving;
  }

  onState(fn: (state: SaveState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The annotation changed; it will be saved shortly. */
  changed(content: AnnotationContent): void {
    if (this.closed) return;
    this.latest = content;
    this.dirty = true;
    if (!this.failed) this.schedule(this.delayMs);
    this.emit();
  }

  /** Save any pending change now. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.dirty || this.saving || !this.latest) return;
    const content = this.latest;
    this.dirty = false;
    this.saving = true;
    this.emit();
    const doc = toDoc(
      content,
      { filename: this.record.filename, sha256: this.record.sha256, width: this.record.width, height: this.record.height },
      this.opts.annotator(),
      this.created,
    );
    try {
      await this.library.saveAnnotation(this.record.id, doc);
      this.created = doc.created;
      this.failed = false;
    } catch (e) {
      if (!this.failed) this.opts.onError?.(e as Error);
      this.failed = true;
      this.dirty = true; // still needs saving
      if (!this.closed) this.schedule(this.retryMs);
    } finally {
      this.saving = false;
      // Changes made while this save was in flight get their own save.
      if (this.dirty && !this.failed && !this.closed) this.schedule(this.delayMs);
      this.emit();
    }
  }

  /** Flush, then stop: later changes are ignored. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    clearTimeout(this.timer);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
