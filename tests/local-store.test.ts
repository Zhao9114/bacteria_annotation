import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { toDoc } from '../src/io/annotation';
import { DEFAULT_MEASUREMENT_SETTINGS } from '../src/measure/measure';
import { LocalStore } from '../src/storage/local';
import type { PreparedImage } from '../src/storage/store';

// Node has no localStorage; the local store keeps the annotator name there.
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
} as Storage;

let n = 0;
function prepared(filename: string, sha256: string): PreparedImage {
  return {
    file: new Blob(['pixels-' + sha256], { type: 'image/png' }),
    filename,
    mime: 'image/png',
    width: 640,
    height: 400,
    sha256,
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  };
}

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

  it('remembers the annotator name', async () => {
    await store.setDisplayName('Dr. Smith');
    expect(store.currentUser().displayName).toBe('Dr. Smith');
  });
});
