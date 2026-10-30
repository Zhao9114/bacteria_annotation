// In-memory LibraryStore adapter for tests: same interface as IndexedDB and
// Supabase, with switches to make saving fail.

import type { AnnotationDoc } from '../src/io/schema';
import type { ImageRecord, ImageSummary, LibraryStore, PreparedImage } from '../src/storage/store';

export class MemoryLibrary implements LibraryStore {
  readonly location = 'browser';
  readonly canShare = false;
  readonly images = new Map<string, { record: ImageRecord; blob: Blob }>();
  readonly annotations = new Map<string, AnnotationDoc>();
  /** Every saved document, in order. */
  readonly saves: AnnotationDoc[] = [];
  /** Make the next N saves throw. */
  failNextSaves = 0;
  /** Make saves wait until this promise resolves. */
  saveGate: Promise<void> | null = null;

  addRecord(id: string, filename = `${id}.png`): ImageRecord {
    const record: ImageRecord = {
      id, owner_id: 'local', owner_name: null, filename, mime: 'image/png',
      width: 640, height: 400, sha256: `sha-${id}`, shared: false, created: '2026-10-30T00:00:00.000Z',
    };
    this.images.set(id, { record, blob: new Blob(['px']) });
    return record;
  }

  async listImages(): Promise<ImageSummary[]> {
    return [...this.images.values()].map(({ record }) => ({ ...record, thumbUrl: '', status: 'not_started', cellCount: 0 }));
  }
  async getImage(id: string) {
    const img = this.images.get(id);
    if (!img) throw new Error('missing');
    return img;
  }
  async addImage(_img: PreparedImage): Promise<ImageRecord | 'duplicate'> {
    throw new Error('not used');
  }
  async deleteImage(id: string): Promise<void> {
    this.images.delete(id);
  }
  async setShared(): Promise<void> {
    throw new Error('not used');
  }
  async getAnnotation(imageId: string): Promise<AnnotationDoc | null> {
    return this.annotations.get(imageId) ?? null;
  }
  async saveAnnotation(imageId: string, doc: AnnotationDoc): Promise<void> {
    if (this.saveGate) await this.saveGate;
    if (this.failNextSaves > 0) {
      this.failNextSaves--;
      throw new Error('network down');
    }
    this.annotations.set(imageId, structuredClone(doc));
    this.saves.push(structuredClone(doc));
  }
}
