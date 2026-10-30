import { describe, expect, it } from 'vitest';
import { History, type Snapshot } from '../src/history';

const snap = (n: number): Snapshot => ({ cells: [], nextCellId: n });

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History();
    let cur = snap(1);
    h.record(cur);
    cur = snap(2);
    h.record(cur);
    cur = snap(3);

    cur = h.undo(cur)!;
    expect(cur.nextCellId).toBe(2);
    cur = h.undo(cur)!;
    expect(cur.nextCellId).toBe(1);
    expect(h.undo(cur)).toBeNull();

    cur = h.redo(cur)!;
    expect(cur.nextCellId).toBe(2);
    cur = h.redo(cur)!;
    expect(cur.nextCellId).toBe(3);
    expect(h.redo(cur)).toBeNull();
  });

  it('a new edit clears the redo stack', () => {
    const h = new History();
    h.record(snap(1));
    const back = h.undo(snap(2))!;
    expect(h.canRedo).toBe(true);
    h.record(back);
    expect(h.canRedo).toBe(false);
  });

  it('stores deep copies', () => {
    const h = new History();
    const s: Snapshot = { cells: [{ id: 1 } as never], nextCellId: 2 };
    h.record(s);
    (s.cells[0] as { id: number }).id = 99;
    expect((h.undo(snap(0))!.cells[0] as { id: number }).id).toBe(1);
  });

  it('keeps at most `limit` entries', () => {
    const h = new History(3);
    for (let i = 0; i < 10; i++) h.record(snap(i));
    let cur = snap(10);
    let count = 0;
    while ((cur = h.undo(cur) ?? (null as never))) count++;
    expect(count).toBe(3);
  });
});
