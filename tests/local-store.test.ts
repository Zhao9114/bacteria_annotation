import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { toDoc } from '../src/io/annotation';
import { DEFAULT_MEASUREMENT_SETTINGS } from '../src/measure/measure';
import { LocalAccount, LocalStore } from '../src/storage/local';
import type { FrameSource, PreparedImage, PreparedVideo } from '../src/storage/store';

// Node has no localStorage; the local store keeps the annotator name there.
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
} as Storage;

let n = 0;
function prepared(filename: string, sha256: string, frame: FrameSource | null = null): PreparedImage {
  return {
    file: new Blob(['pixels-' + sha256], { type: 'image/png' }),
    filename,
    mime: 'image/png',
    width: 640,
    height: 400,
    sha256,
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
    frame,
  };
}

const video: PreparedVideo = {
  filename: 'iPhone 14 Pro.mp4',
  sha256: 'video-sha',
  phone: 'iPhone 14 Pro',
  pixel_size_um: 2.44,
  width: 320,
  height: 568,
  fps: 30,
  frame_count: 747,
  duration: 24.9,
};

describe('LocalStore', () => {
  let store: LocalStore;
  beforeEach(async () => {
    store = await LocalStore.open(`test-db-${n++}`);
  });

  it('adds, lists in natural filename order, and rejects duplicates', async () => {
    await store.addImage(prepared('cell10.png', 'b'));
    await store.addImage(prepared('cell2.png', 'a'));
    expect(await store.addImage(prepared('copy-of-cell2.png', 'a'))).toBe('duplicate');
    const list = await store.listImages('mine');
    expect(list.map((i) => i.filename)).toEqual(['cell2.png', 'cell10.png']);
    expect(list[0]).toMatchObject({ status: 'not_started', cellCount: 0, width: 640, shared: false });
    expect(await store.listImages('shared')).toEqual([]);
  });

  it('returns the original image bytes', async () => {
    const rec = (await store.addImage(prepared('a.png', 'x'))) as { id: string };
    const { record, blob } = await store.getImage(rec.id);
    expect(record.filename).toBe('a.png');
    expect(await blob.text()).toBe('pixels-x');
  });

  it('saves annotations and reflects them in the library', async () => {
    const rec = (await store.addImage(prepared('a.png', 'x'))) as { id: string };
    expect(await store.getAnnotation(rec.id)).toBeNull();
    const doc = toDoc(
      { cells: [], status: 'done', measurement: DEFAULT_MEASUREMENT_SETTINGS },
      { filename: 'a.png', sha256: 'x', width: 640, height: 400 },
      'Me',
      null,
    );
    await store.saveAnnotation(rec.id, doc);
    expect(await store.getAnnotation(rec.id)).toEqual(doc);
    expect((await store.listImages('mine'))[0].status).toBe('done');
  });

  it('deleting an image removes its annotation too', async () => {
    const rec = (await store.addImage(prepared('a.png', 'x'))) as { id: string };
    await store.deleteImage(rec.id);
    expect(await store.listImages('mine')).toEqual([]);
    expect(await store.getAnnotation(rec.id)).toBeNull();
    await expect(store.getImage(rec.id)).rejects.toThrow();
  });

  it('keeps video frames out of the image list and lists them per video in frame order', async () => {
    await store.addImage(prepared('a.png', 'x'));
    const v = await store.addVideo(video);
    await store.addImage(prepared('f312.png', 'f312', { video_id: v.id, index: 312, time: 10.4 }));
    await store.addImage(prepared('f45.png', 'f45', { video_id: v.id, index: 45, time: 1.5 }));
    expect((await store.listImages('mine')).map((i) => i.filename)).toEqual(['a.png']);
    expect((await store.listFrames(v.id)).map((f) => f.frame?.index)).toEqual([45, 312]);
    const [summary] = await store.listVideos('mine');
    expect(summary).toMatchObject({ phone: 'iPhone 14 Pro', frames: 2, started: 0, done: 0, frame_count: 747 });
    expect(summary.thumbUrl).not.toBe('');
  });

  it('counts frames marked done, finds a video again by its hash, and edits it', async () => {
    const v = await store.addVideo(video);
    const f = (await store.addImage(prepared('f1.png', 'f1', { video_id: v.id, index: 1, time: 0 }))) as { id: string };
    const doc = toDoc(
      { cells: [], status: 'done', measurement: DEFAULT_MEASUREMENT_SETTINGS },
      { filename: 'f1.png', sha256: 'f1', width: 320, height: 568 },
      'Me',
      null,
    );
    await store.saveAnnotation(f.id, doc);
    expect((await store.listVideos('mine'))[0]).toMatchObject({ frames: 1, started: 1, done: 1 });
    expect((await store.findVideo('video-sha'))?.id).toBe(v.id);
    expect(await store.findVideo('other')).toBeNull();
    await store.updateVideo(v.id, { phone: 'iPhone 14 Pro (lab)', pixel_size_um: null });
    expect(await store.getVideo(v.id)).toMatchObject({ phone: 'iPhone 14 Pro (lab)', pixel_size_um: null });
  });

  it('deleting a video deletes its frames and their annotations', async () => {
    const v = await store.addVideo(video);
    const f = (await store.addImage(prepared('f1.png', 'f1', { video_id: v.id, index: 1, time: 0 }))) as { id: string };
    await store.deleteVideo(v.id);
    expect(await store.listVideos('mine')).toEqual([]);
    expect(await store.listFrames(v.id)).toEqual([]);
    await expect(store.getImage(f.id)).rejects.toThrow();
    await expect(store.getVideo(v.id)).rejects.toThrow();
  });

  it('opens a library saved before videos existed', async () => {
    const name = `old-db-${n++}`;
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('images', { keyPath: 'id' }).createIndex('sha256', 'sha256', { unique: true });
        db.createObjectStore('thumbs');
        db.createObjectStore('annotations');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').add({ id: 'old', filename: 'old.png', sha256: 'o', width: 1, height: 1, blob: new Blob(['x']) });
        tx.oncomplete = () => (db.close(), resolve());
      };
    });
    const old = await LocalStore.open(name);
    expect((await old.listImages('mine')).map((i) => [i.filename, i.frame])).toEqual([['old.png', null]]);
    expect(await old.listVideos('mine')).toEqual([]);
  });

  it('the local account remembers the annotator name and announces changes', async () => {
    const account = new LocalAccount();
    let heard = 0;
    account.onChange(() => heard++);
    await account.setDisplayName('Dr. Smith');
    expect(account.currentUser().displayName).toBe('Dr. Smith');
    expect(heard).toBe(1);
  });
});
