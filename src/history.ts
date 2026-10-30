// Undo/redo for cell edits: a bounded stack of deep-copied snapshots.
// Callers record the state *before* each change.

import type { Cell } from './io/schema';

export interface Snapshot {
  cells: Cell[];
  nextCellId: number;
}

export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Save `current` as an undo point and drop any redo history. */
  record(current: Snapshot): void {
    this.past.push(structuredClone(current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Returns the state to restore, or null if there is nothing to undo. */
  undo(current: Snapshot): Snapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(structuredClone(current));
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
