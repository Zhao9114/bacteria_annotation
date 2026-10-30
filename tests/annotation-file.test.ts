import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationContent } from '../src/io/annotation';
import { DEFAULT_MEASUREMENT_SETTINGS } from '../src/measure/measure';
import { AnnotationFile, type SaveState } from '../src/storage/annotation-file';
import { MemoryLibrary } from './memory-library';

const content = (status: AnnotationContent['status'] = 'in_progress'): AnnotationContent => ({
  cells: [],
  status,
  measurement: DEFAULT_MEASUREMENT_SETTINGS,
});

async function open(lib: MemoryLibrary, onError = vi.fn()) {
  const states: SaveState[] = [];
  const file = await AnnotationFile.open(lib, 'img1', { annotator: () => 'Dr. Smith', delayMs: 800, retryMs: 5000, onError });
  file.onState((s) => states.push(s));
  return { file, states, onError };
}

/** Run due timers and let the save's promises settle. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('AnnotationFile', () => {
  let lib: MemoryLibrary;
  beforeEach(() => {
    vi.useFakeTimers();
    lib = new MemoryLibrary();
    lib.addRecord('img1', 'cell3.png');
  });
  afterEach(() => vi.useRealTimers());

  it('opens the image with no annotation yet', async () => {
    const { file } = await open(lib);
    expect(file.record.filename).toBe('cell3.png');
    expect(await file.blob.text()).toBe('px');
    expect(file.initial).toBeNull();
    expect(file.state).toBe('saved');
  });

  it('saves shortly after a change, stamped with the annotator and image', async () => {
    const { file, states } = await open(lib);
    file.changed(content());
    expect(file.state).toBe('saving');
    await advance(799);
    expect(lib.saves).toHaveLength(0);
    await advance(1);
    expect(lib.saves).toHaveLength(1);
    expect(lib.saves[0]).toMatchObject({ annotator: 'Dr. Smith', image: { filename: 'cell3.png', sha256: 'sha-img1' } });
    expect(file.state).toBe('saved');
    expect(states.at(-1)).toBe('saved');
  });

  it('a burst of changes becomes one save of the latest content', async () => {
    const { file } = await open(lib);
    file.changed(content('in_progress'));
    await advance(500);
    file.changed(content('done'));
    await advance(800);
    expect(lib.saves.map((d) => d.status)).toEqual(['done']);
  });

  it('keeps the creation time across saves and reopens', async () => {
    const { file } = await open(lib);
    file.changed(content());
    await advance(800);
    const created = lib.saves[0].created;
    await advance(60_000);
    file.changed(content('done'));
    await advance(800);
    expect(lib.saves[1].created).toBe(created);
    expect(lib.saves[1].modified).not.toBe(created);
    const reopened = await AnnotationFile.open(lib, 'img1', { annotator: () => 'x' });
    expect(reopened.initial?.status).toBe('done');
  });

  it('a failed save is reported once, retried, and recovers', async () => {
    lib.failNextSaves = 2;
    const { file, onError } = await open(lib);
    file.changed(content());
    await advance(800);
    expect(file.state).toBe('failed');
    expect(file.pending).toBe(true);
    await advance(5000); // retry 1 fails too
    expect(onError).toHaveBeenCalledTimes(1);
    await advance(5000); // retry 2 succeeds
    expect(file.state).toBe('saved');
    expect(lib.saves).toHaveLength(1);
  });

  it('a change made during a save gets its own save', async () => {
    let release!: () => void;
    lib.saveGate = new Promise((r) => (release = r));
    const { file } = await open(lib);
    file.changed(content('in_progress'));
    await advance(800); // save 1 in flight, waiting on the gate
    file.changed(content('done'));
    lib.saveGate = null;
    release();
    await advance(0);
    await advance(800);
    expect(lib.saves.map((d) => d.status)).toEqual(['in_progress', 'done']);
    expect(file.state).toBe('saved');
  });

  it('flush saves now; close flushes and ignores later changes', async () => {
    const { file } = await open(lib);
    file.changed(content());
    await file.flush();
    expect(lib.saves).toHaveLength(1);
    file.changed(content('done'));
    await file.close();
    expect(lib.saves).toHaveLength(2);
    file.changed(content('not_started'));
    await advance(10_000);
    expect(lib.saves).toHaveLength(2);
  });
});
