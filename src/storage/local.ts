// Browser-only backend: images and annotations in IndexedDB, the annotator's
// name in localStorage. One implicit local user; nothing leaves the device, so
// there is no sign-in and no sharing.

import type { AnnotationDoc } from '../io/schema';
import type { Account, ImageRecord, ImageSummary, LibraryScope, LibraryStore, PreparedImage, User } from './store';
import { compareImages } from './store';

const DB_NAME = 'bacteria-annotation';
const DB_VERSION = 1;
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
    req.onupgradeneeded = () => {
      const db = req.result;
      const images = db.createObjectStore('images', { keyPath: 'id' });
      images.createIndex('sha256', 'sha256', { unique: true });
      db.createObjectStore('thumbs');
      db.createObjectStore('annotations');
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

  async listImages(scope: LibraryScope): Promise<ImageSummary[]> {
    if (scope === 'shared') return [];
    const tx = this.db.transaction(['images', 'thumbs', 'annotations'], 'readonly');
    const images = (await promisify(tx.objectStore('images').getAll())) as StoredImage[];
    const out: ImageSummary[] = [];
    for (const { blob: _blob, ...record } of images) {
      const doc = (await promisify(tx.objectStore('annotations').get(record.id))) as AnnotationDoc | undefined;
      out.push({
        ...record,
        thumbUrl: await this.thumbUrl(tx, record.id),
        status: doc?.status ?? 'not_started',
        cellCount: doc?.cells.length ?? 0,
      });
    }
    return out.sort(compareImages);
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

  async getImage(id: string): Promise<{ record: ImageRecord; blob: Blob }> {
    const stored = (await promisify(this.db.transaction('images').objectStore('images').get(id))) as StoredImage | undefined;
    if (!stored) throw new Error('This image is no longer in the library.');
    const { blob, ...record } = stored;
    return { record, blob };
  }

  async addImage(img: PreparedImage): Promise<ImageRecord | 'duplicate'> {
    const existing = await promisify(this.db.transaction('images').objectStore('images').index('sha256').getKey(img.sha256));
    if (existing !== undefined) return 'duplicate';
    if (!this.askedPersist) {
      // Ask the browser not to evict our data under storage pressure.
      this.askedPersist = true;
      void navigator.storage?.persist?.();
    }
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
    const url = this.thumbUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.thumbUrls.delete(id);
  }

  async setShared(): Promise<void> {
    throw new Error('Sharing needs the online version (Supabase).'); // canShare is false
  }

  async getAnnotation(imageId: string): Promise<AnnotationDoc | null> {
    const doc = await promisify(this.db.transaction('annotations').objectStore('annotations').get(imageId));
    return (doc as AnnotationDoc | undefined) ?? null;
  }

  async saveAnnotation(imageId: string, doc: AnnotationDoc): Promise<void> {
    const tx = this.db.transaction('annotations', 'readwrite');
    tx.objectStore('annotations').put(doc, imageId);
    await done(tx);
  }
}
