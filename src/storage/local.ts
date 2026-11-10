// Browser-only backend: images, videos and annotations in IndexedDB, the
// annotator's name in localStorage. One implicit local user; nothing leaves the
// device, so there is no sign-in and no sharing.

import type { AnnotationDoc } from '../io/schema';
import type {
  Account,
  ImageRecord,
  ImageSummary,
  LibraryScope,
  LibraryStore,
  PreparedImage,
  PreparedVideo,
  User,
  VideoChange,
  VideoRecord,
  VideoSummary,
} from './store';
import { compareImages, compareVideos } from './store';

const DB_NAME = 'bacteria-annotation';
/** 1: images, thumbs, annotations. 2: videos. */
const DB_VERSION = 2;
const NAME_KEY = 'annotatorName';

interface StoredImage extends ImageRecord {
  blob: Blob;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const images = db.createObjectStore('images', { keyPath: 'id' });
        images.createIndex('sha256', 'sha256', { unique: true });
        db.createObjectStore('thumbs');
        db.createObjectStore('annotations');
      }
      if (e.oldVersion < 2) {
        const videos = db.createObjectStore('videos', { keyPath: 'id' });
        videos.createIndex('sha256', 'sha256', { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The single person using this browser; their name is all there is to an account. */
export class LocalAccount implements Account {
  private readonly listeners = new Set<() => void>();

  currentUser(): User {
    return { id: 'local', email: null, displayName: localStorage.getItem(NAME_KEY) };
  }

  async setDisplayName(name: string): Promise<void> {
    localStorage.setItem(NAME_KEY, name);
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export class LocalStore implements LibraryStore {
  readonly location = 'browser';
  readonly canShare = false;
  private thumbUrls = new Map<string, string>();
  private askedPersist = false;

  constructor(private readonly db: IDBDatabase) {}

  static async open(name?: string): Promise<LocalStore> {
    return new LocalStore(await openDb(name));
  }

  // ---------- images ----------

  async listImages(scope: LibraryScope): Promise<ImageSummary[]> {
    if (scope === 'shared') return [];
    const tx = this.db.transaction(['images', 'thumbs', 'annotations'], 'readonly');
    const images = (await this.allImages(tx)).filter((r) => !r.frame);
    return (await Promise.all(images.map((r) => this.summarize(tx, r)))).sort(compareImages);
  }

  async listFrames(videoId: string): Promise<ImageSummary[]> {
    const tx = this.db.transaction(['images', 'thumbs', 'annotations'], 'readonly');
    const frames = (await this.allImages(tx)).filter((r) => r.frame?.video_id === videoId);
    return (await Promise.all(frames.map((r) => this.summarize(tx, r)))).sort(compareImages);
  }

  async getImage(id: string): Promise<{ record: ImageRecord; blob: Blob }> {
    const stored = (await promisify(this.db.transaction('images').objectStore('images').get(id))) as StoredImage | undefined;
    if (!stored) throw new Error('This image is no longer in the library.');
    const { blob, ...record } = stored;
    return { record: withFrame(record), blob };
  }

  async addImage(img: PreparedImage): Promise<ImageRecord | 'duplicate'> {
    const existing = await promisify(this.db.transaction('images').objectStore('images').index('sha256').getKey(img.sha256));
    if (existing !== undefined) return 'duplicate';
    this.askToPersist();
    const record: ImageRecord = {
      id: crypto.randomUUID(),
      owner_id: 'local',
      owner_name: null,
      filename: img.filename,
      mime: img.mime,
      width: img.width,
      height: img.height,
      sha256: img.sha256,
      shared: false,
      created: new Date().toISOString(),
      frame: img.frame,
    };
    const tx = this.db.transaction(['images', 'thumbs'], 'readwrite');
    tx.objectStore('images').add({ ...record, blob: img.file } satisfies StoredImage);
    tx.objectStore('thumbs').put(img.thumb, record.id);
    await done(tx);
    return record;
  }

  async deleteImage(id: string): Promise<void> {
    const tx = this.db.transaction(['images', 'thumbs', 'annotations'], 'readwrite');
    for (const name of ['images', 'thumbs', 'annotations']) tx.objectStore(name).delete(id);
    await done(tx);
    this.forgetThumb(id);
  }

  async setShared(): Promise<void> {
    throw new Error('Sharing needs the online version (Supabase).'); // canShare is false
  }

  // ---------- videos ----------

  async listVideos(scope: LibraryScope): Promise<VideoSummary[]> {
    if (scope === 'shared') return [];
    const tx = this.db.transaction(['videos', 'images', 'thumbs', 'annotations'], 'readonly');
    const videos = (await promisify(tx.objectStore('videos').getAll())) as VideoRecord[];
    const frames = (await this.allImages(tx)).filter((r) => r.frame).sort(compareImages);
    const out = await Promise.all(
      videos.map(async (v) => {
        const mine = await Promise.all(frames.filter((f) => f.frame!.video_id === v.id).map((f) => this.summarize(tx, f)));
        return { ...v, thumbUrl: mine[0]?.thumbUrl ?? '', frames: mine.length, started: mine.filter((f) => f.status !== 'not_started').length, done: mine.filter((f) => f.status === 'done').length };
      }),
    );
    return out.sort(compareVideos);
  }

  async getVideo(id: string): Promise<VideoRecord> {
    const v = (await promisify(this.db.transaction('videos').objectStore('videos').get(id))) as VideoRecord | undefined;
    if (!v) throw new Error('This video is no longer in the library.');
    return v;
  }

  async findVideo(sha256: string): Promise<VideoRecord | null> {
    const v = await promisify(this.db.transaction('videos').objectStore('videos').index('sha256').get(sha256));
    return (v as VideoRecord | undefined) ?? null;
  }

  async addVideo(video: PreparedVideo): Promise<VideoRecord> {
    this.askToPersist();
    const record: VideoRecord = {
      ...video,
      id: crypto.randomUUID(),
      owner_id: 'local',
      owner_name: null,
      shared: false,
      created: new Date().toISOString(),
    };
    const tx = this.db.transaction('videos', 'readwrite');
    tx.objectStore('videos').add(record);
    await done(tx);
    return record;
  }

  async updateVideo(id: string, change: VideoChange): Promise<void> {
    const tx = this.db.transaction('videos', 'readwrite');
    const store = tx.objectStore('videos');
    const v = (await promisify(store.get(id))) as VideoRecord | undefined;
    if (!v) throw new Error('This video is no longer in the library.');
    store.put({ ...v, ...change });
    await done(tx);
  }

  async deleteVideo(id: string): Promise<void> {
    const tx = this.db.transaction(['videos', 'images', 'thumbs', 'annotations'], 'readwrite');
    const frames = (await this.allImages(tx)).filter((r) => r.frame?.video_id === id);
    for (const f of frames) for (const name of ['images', 'thumbs', 'annotations']) tx.objectStore(name).delete(f.id);
    tx.objectStore('videos').delete(id);
    await done(tx);
    for (const f of frames) this.forgetThumb(f.id);
  }

  async setVideoShared(): Promise<void> {
    throw new Error('Sharing needs the online version (Supabase).'); // canShare is false
  }

  // ---------- annotations ----------

  async getAnnotation(imageId: string): Promise<AnnotationDoc | null> {
    const doc = await promisify(this.db.transaction('annotations').objectStore('annotations').get(imageId));
    return (doc as AnnotationDoc | undefined) ?? null;
  }

  async saveAnnotation(imageId: string, doc: AnnotationDoc): Promise<void> {
    const tx = this.db.transaction('annotations', 'readwrite');
    tx.objectStore('annotations').put(doc, imageId);
    await done(tx);
  }

  // ---------- internals ----------

  /** Every stored image record (frames included), without the image bytes. */
  private async allImages(tx: IDBTransaction): Promise<ImageRecord[]> {
    const images = (await promisify(tx.objectStore('images').getAll())) as StoredImage[];
    return images.map(({ blob: _blob, ...record }) => withFrame(record));
  }

  private async summarize(tx: IDBTransaction, record: ImageRecord): Promise<ImageSummary> {
    const doc = (await promisify(tx.objectStore('annotations').get(record.id))) as AnnotationDoc | undefined;
    return {
      ...record,
      thumbUrl: await this.thumbUrl(tx, record.id),
      status: doc?.status ?? 'not_started',
      cellCount: doc?.cells.length ?? 0,
    };
  }

  private async thumbUrl(tx: IDBTransaction, id: string): Promise<string> {
    let url = this.thumbUrls.get(id);
    if (!url) {
      const blob = (await promisify(tx.objectStore('thumbs').get(id))) as Blob | undefined;
      url = blob ? URL.createObjectURL(blob) : '';
      this.thumbUrls.set(id, url);
    }
    return url;
  }

  private forgetThumb(id: string): void {
    const url = this.thumbUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.thumbUrls.delete(id);
  }

  /** Ask the browser not to evict our data under storage pressure (once). */
  private askToPersist(): void {
    if (this.askedPersist) return;
    this.askedPersist = true;
    void navigator.storage?.persist?.();
  }
}

/** Records saved before videos existed have no `frame` field. */
function withFrame(record: Omit<ImageRecord, 'frame'> & { frame?: ImageRecord['frame'] }): ImageRecord {
  return { ...record, frame: record.frame ?? null };
}
