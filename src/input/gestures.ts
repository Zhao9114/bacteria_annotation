// The gesture recognizer: turns raw pointer events (mouse, pen, touch) into
// what the user meant. Pure: it never touches the DOM or the clock, so tests
// feed it event sequences with explicit timestamps.
//
//   press-and-release in place ......... tap(p, count)   (count 2 = double-tap)
//   press claimed by the app, then move  dragMove / dragEnd  (move a point, trace)
//   press not claimed, then move ....... pan(dx, dy)      (also middle button / pan key)
//   second finger ...................... pinchStart / pinchMove / pinchEnd
//                                        (cancels whatever the first finger started)
//   mouse moving with no button ........ hover(p); hover(null) on leave or finger lift
//
// Coordinates are screen pixels relative to the canvas.

import type { Point } from '../canvas/viewport';

export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface GestureEvent {
  type: 'down' | 'move' | 'up' | 'cancel' | 'leave';
  id: number;
  p: Point;
  pointerType: PointerKind;
  /** 0 = primary, 1 = middle. Ignored for touch. */
  button?: number;
  /** A "pan" key such as Space is held: presses pan instead of drawing. */
  panKey?: boolean;
  /** Milliseconds, e.g. PointerEvent.timeStamp. */
  time: number;
}

export interface GestureHandlers {
  /** A primary press began. Return true to own the drag that may follow (e.g. a grabbed point or a freehand trace). */
  pressStart(p: Point, pointerType: PointerKind): boolean;
  dragMove(p: Point): void;
  dragEnd(p: Point): void;
  /** The owned drag was interrupted (a second finger landed). */
  dragCancel(): void;
  tap(p: Point, count: number, pointerType: PointerKind): void;
  pan(dx: number, dy: number): void;
  pinchStart(): void;
  /** Fingers were at a0/b0 when the pinch started and are now at a1/b1. */
  pinchMove(a0: Point, b0: Point, a1: Point, b1: Point): void;
  pinchEnd(): void;
  hover(p: Point | null): void;
}

/** Movement (screen px) before a press stops being a tap. */
const SLOP: Record<PointerKind, number> = { mouse: 4, pen: 6, touch: 8 };
/** A second tap this soon (ms) and this close (screen px) counts as a double-tap. */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX: Record<PointerKind, number> = { mouse: 6, pen: 12, touch: 24 };

type Mode = 'pending' | 'owned' | 'panning';

export class GestureRecognizer {
  private primary: { id: number; start: Point; last: Point; kind: PointerKind; mode: Mode } | null = null;
  private readonly touches = new Map<number, Point>();
  private pinch: { a: number; b: number; a0: Point; b0: Point } | null = null;
  private lastTap: { time: number; p: Point; count: number } | null = null;

  constructor(private readonly on: GestureHandlers) {}

  /** True while the view is being dragged around, for the "grabbing" cursor. */
  get panning(): boolean {
    return this.primary?.mode === 'panning';
  }

  /** True while a press the app owns is in progress. */
  get dragging(): boolean {
    return this.primary?.mode === 'owned';
  }

  get pinching(): boolean {
    return this.pinch !== null;
  }

  handle(e: GestureEvent): void {
    switch (e.type) {
      case 'down':
        return this.down(e);
      case 'move':
        return this.move(e);
      case 'up':
        return this.up(e, true);
      case 'cancel':
        return this.up(e, false);
      case 'leave':
        if (!this.primary && !this.pinch) this.on.hover(null);
    }
  }

  private down(e: GestureEvent): void {
    if (e.pointerType === 'touch') {
      this.touches.set(e.id, e.p);
      if (this.touches.size === 2) return this.startPinch();
      if (this.touches.size > 2 || this.pinch) return;
    } else if (e.button !== undefined && e.button !== 0 && e.button !== 1) {
      return;
    }
    const forcePan = e.button === 1 || !!e.panKey;
    const mode: Mode = forcePan ? 'panning' : this.on.pressStart(e.p, e.pointerType) ? 'owned' : 'pending';
    this.primary = { id: e.id, start: e.p, last: e.p, kind: e.pointerType, mode };
    this.on.hover(null);
  }

  private startPinch(): void {
    if (this.primary?.mode === 'owned') this.on.dragCancel();
    this.primary = null;
    const [[a, a0], [b, b0]] = [...this.touches.entries()];
    this.pinch = { a, b, a0, b0 };
    this.on.pinchStart();
  }

  private move(e: GestureEvent): void {
    if (this.touches.has(e.id)) this.touches.set(e.id, e.p);
    if (this.pinch) {
      const a1 = this.touches.get(this.pinch.a);
      const b1 = this.touches.get(this.pinch.b);
      if (a1 && b1) this.on.pinchMove(this.pinch.a0, this.pinch.b0, a1, b1);
      return;
    }
    const pr = this.primary;
    if (!pr || pr.id !== e.id) {
      // Fingers don't hover; a mouse or pen with no button down does.
      if (!pr && e.pointerType !== 'touch') this.on.hover(e.p);
      return;
    }
    if (pr.mode === 'pending' && dist(e.p, pr.start) > SLOP[pr.kind]) pr.mode = 'panning';
    if (pr.mode === 'pending') return; // keep `last` at the start so no movement is lost when panning begins
    if (pr.mode === 'panning') this.on.pan(e.p[0] - pr.last[0], e.p[1] - pr.last[1]);
    else this.on.dragMove(e.p);
    pr.last = e.p;
  }

  private up(e: GestureEvent, completed: boolean): void {
    this.touches.delete(e.id);
    if (this.pinch) {
      // Stay in the pinch until every finger has lifted; it never becomes a tap.
      if (this.touches.size === 0) {
        this.pinch = null;
        this.on.pinchEnd();
      }
      return;
    }
    const pr = this.primary;
    if (!pr || pr.id !== e.id) return;
    this.primary = null;
    if (pr.mode === 'owned') this.on.dragEnd(e.p);
    else if (pr.mode === 'pending' && completed) this.tap(e.p, pr.kind, e.time);
    if (e.pointerType === 'touch') this.on.hover(null);
  }

  private tap(p: Point, kind: PointerKind, time: number): void {
    const prev = this.lastTap;
    const count =
      prev && time - prev.time <= DOUBLE_TAP_MS && dist(p, prev.p) <= DOUBLE_TAP_PX[kind] ? prev.count + 1 : 1;
    this.lastTap = { time, p, count };
    this.on.tap(p, count, kind);
  }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
