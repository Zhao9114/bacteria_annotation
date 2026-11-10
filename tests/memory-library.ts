// In-memory LibraryStore adapter for tests: same interface as IndexedDB and
// Supabase, with switches to make saving fail.

import type { AnnotationDoc } from '../src/io/schema';
import type {
  ImageRecord,
  ImageSummary,
  LibraryStore,
  PreparedImage,
  PreparedVideo,
  VideoChange,
  VideoRecord,
  VideoSummary,
} from '../src/storage/store';
import { compareImages } from '../src/storage/store';

export class MemoryLibrary implements LibraryStore {
  readonly location = 'browser';
  readonly canShare = false;
  readonly images = new Map<string, { record: ImageRecord; blob: Blob }>();
  readonly videos = new Map<string, VideoRecord>();
  readonly annotations = new Map<string, AnnotationDoc>();
  /** Every saved document, in order. */
  readonly saves: AnnotationDoc[] = [];
  /** Make the next N saves throw. */
  failNextSaves = 0;
  /** Make saves wait until this promise resolves. */
  saveGate: Promise<void> | null = null;

  addRecord(id: string, filename = `${id}.png`, frame: ImageRecord['frame'] = null): ImageRecord {
    const record: ImageRecord = {
      id, owner_id: 'local', owner_name: null, filename, mime: 'image/png',
      width: 640, height: 400, sha256: `sha-${id}`, shared: false, created: '2026-10-30T00:00:00.000Z', frame,
    };
    this.images.set(id, { record, blob: new Blob(['px']) });
    return record;
  }

  private summary(record: ImageRecord): ImageSummary {
    const doc = this.annotations.get(record.id);
    return { ...record, thumbUrl: '', status: doc?.status ?? 'not_started', cellCount: doc?.cells.length ?? 0 };
  }

  async listImages(): Promise<ImageSummary[]> {
    return [...this.images.values()].filter(({ record }) => !record.frame).map(({ record }) => this.summary(record)).sort(compareImages);
  }
  async listFrames(videoId: string): Promise<ImageSummary[]> {
    return [...this.images.values()]
      .filter(({ record }) => record.frame?.video_id === videoId)
      .map(({ record }) => this.summary(record))
      .sort(compareImages);
  }
  async getImage(id: string) {
    const img = this.images.get(id);
    if (!img) throw new Error('missing');
    return img;
  }
  async addImage(img: PreparedImage): Promise<ImageRecord | 'duplicate'> {
    if ([...this.images.values()].some(({ record }) => record.sha256 === img.sha256)) return 'duplicate';
    const record = this.addRecord(crypto.randomUUID(), img.filename, img.frame);
    record.sha256 = img.sha256;
    return record;
  }
  async deleteImage(id: string): Promise<void> {
    this.images.delete(id);
  }
  async setShared(): Promise<void> {
    throw new Error('not used');
  }

  async listVideos(): Promise<VideoSummary[]> {
    return Promise.all(
      [...this.videos.values()].map(async (v) => {
        const frames = await this.listFrames(v.id);
        return { ...v, thumbUrl: '', frames: frames.length, started: frames.filter((f) => f.status !== 'not_started').length, done: frames.filter((f) => f.status === 'done').length };
      }),
    );
  }
  async getVideo(id: string): Promise<VideoRecord> {
    const v = this.videos.get(id);
    if (!v) throw new Error('missing');
    return v;
  }
  async findVideo(sha256: string): Promise<VideoRecord | null> {
    return [...this.videos.values()].find((v) => v.sha256 === sha256) ?? null;
  }
  async addVideo(video: PreparedVideo): Promise<VideoRecord> {
    const record: VideoRecord = { ...video, id: crypto.randomUUID(), owner_id: 'local', owner_name: null, shared: false, created: '' };
    this.videos.set(record.id, record);
    return record;
  }
  async updateVideo(id: string, change: VideoChange): Promise<void> {
    this.videos.set(id, { ...(await this.getVideo(id)), ...change });
  }
  async deleteVideo(id: string): Promise<void> {
    for (const f of await this.listFrames(id)) this.images.delete(f.id);
    this.videos.delete(id);
  }
  async setVideoShared(): Promise<void> {
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
