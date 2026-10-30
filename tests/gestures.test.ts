import { describe, expect, it } from 'vitest';
import type { Point } from '../src/canvas/viewport';
import { GestureRecognizer, type GestureEvent, type GestureHandlers, type PointerKind } from '../src/input/gestures';

/** A recognizer whose callbacks append to a log; `own` decides whether presses are claimed. */
function setup(own: (p: Point) => boolean = () => false) {
  const log: string[] = [];
  const pans: [number, number][] = [];
  const h: GestureHandlers = {
    pressStart: (p) => {
      log.push(`press ${p}`);
      return own(p);
    },
    dragMove: (p) => log.push(`drag ${p}`),
    dragEnd: (p) => log.push(`dragEnd ${p}`),
    dragCancel: () => log.push('dragCancel'),
    tap: (p, n) => log.push(`tap ${p} x${n}`),
    pan: (dx, dy) => pans.push([dx, dy]),
    pinchStart: () => log.push('pinchStart'),
    pinchMove: (a0, b0, a1, b1) => log.push(`pinch ${a0}|${b0} -> ${a1}|${b1}`),
    pinchEnd: () => log.push('pinchEnd'),
    hover: (p) => log.push(`hover ${p}`),
  };
  const g = new GestureRecognizer(h);
  let t = 0;
  const send = (type: GestureEvent['type'], p: Point, opts: Partial<GestureEvent> = {}) =>
    g.handle({ type, p, id: 1, pointerType: 'mouse', button: 0, time: (t += 16), ...opts });
  const wait = (ms: number) => (t += ms);
  return { g, log, pans, send, wait };
}

const kinds: PointerKind[] = ['mouse', 'touch'];

describe('taps', () => {
  for (const pointerType of kinds) {
    it(`${pointerType}: press and release in place is a tap`, () => {
      const { log, send } = setup();
      send('down', [10, 10], { pointerType });
      send('move', [12, 11], { pointerType }); // inside the slop
      send('up', [12, 11], { pointerType });
      expect(log.filter((l) => l.startsWith('tap'))).toEqual(['tap 12,11 x1']);
    });
  }

  it('two quick taps close together are a double-tap; a slow one is not', () => {
    const { log, send, wait } = setup();
    send('down', [50, 50]);
    send('up', [50, 50]);
    send('down', [52, 51]);
    send('up', [52, 51]);
    wait(600);
    send('down', [52, 51]);
    send('up', [52, 51]);
    expect(log.filter((l) => l.startsWith('tap'))).toEqual(['tap 50,50 x1', 'tap 52,51 x2', 'tap 52,51 x1']);
  });

  it('two quick taps far apart are two single taps', () => {
    const { log, send } = setup();
    send('down', [50, 50]);
    send('up', [50, 50]);
    send('down', [150, 50]);
    send('up', [150, 50]);
    expect(log.filter((l) => l.startsWith('tap'))).toEqual(['tap 50,50 x1', 'tap 150,50 x1']);
  });

  it('a cancelled press is not a tap', () => {
    const { log, send } = setup();
    send('down', [10, 10]);
    send('cancel', [10, 10]);
    expect(log.some((l) => l.startsWith('tap'))).toBe(false);
  });
});

describe('panning', () => {
  it('an unclaimed press that moves past the slop pans and does not tap', () => {
    const { log, pans, send } = setup();
    send('down', [10, 10]);
    send('move', [13, 10]); // within slop: nothing yet
    send('move', [30, 20]);
    send('move', [40, 25]);
    send('up', [40, 25]);
    // The first pan includes the movement made inside the slop, so nothing is lost.
    expect(pans).toEqual([[20, 10], [10, 5]]);
    expect(log.some((l) => l.startsWith('tap'))).toBe(false);
  });

  it('touch needs a bigger wobble before it pans', () => {
    const { pans, send } = setup();
    send('down', [10, 10], { pointerType: 'touch' });
    send('move', [16, 10], { pointerType: 'touch' }); // 6 px: still a tap for a finger
    expect(pans).toEqual([]);
    send('move', [20, 10], { pointerType: 'touch' });
    expect(pans).toEqual([[10, 0]]);
  });

  it('middle button and the pan key pan at once, without asking the app', () => {
    const { log, pans, send } = setup(() => true);
    send('down', [0, 0], { button: 1 });
    send('move', [2, 0], { button: 1 });
    send('up', [2, 0], { button: 1 });
    send('down', [0, 0], { panKey: true });
    send('move', [0, 3], { panKey: true });
    send('up', [0, 3], { panKey: true });
    expect(pans).toEqual([[2, 0], [0, 3]]);
    expect(log.some((l) => l.startsWith('press'))).toBe(false);
  });

  it('right clicks are ignored', () => {
    const { log, send } = setup();
    send('down', [5, 5], { button: 2 });
    send('up', [5, 5], { button: 2 });
    expect(log.filter((l) => !l.startsWith('hover'))).toEqual([]);
  });
});

describe('owned drags', () => {
  it('a claimed press drags from the first movement and never taps', () => {
    const { log, pans, send } = setup(() => true);
    send('down', [10, 10]);
    send('move', [11, 10]);
    send('move', [15, 12]);
    send('up', [15, 12]);
    expect(log.filter((l) => !l.startsWith('hover'))).toEqual(['press 10,10', 'drag 11,10', 'drag 15,12', 'dragEnd 15,12']);
    expect(pans).toEqual([]);
  });
});

describe('pinch', () => {
  it('a second finger cancels the first finger’s drag and pinches; lifting does not tap', () => {
    const { log, send } = setup(() => true);
    send('down', [100, 100], { pointerType: 'touch', id: 1 });
    send('move', [105, 100], { pointerType: 'touch', id: 1 });
    send('down', [200, 100], { pointerType: 'touch', id: 2 });
    send('move', [90, 100], { pointerType: 'touch', id: 1 });
    send('move', [220, 100], { pointerType: 'touch', id: 2 });
    send('up', [90, 100], { pointerType: 'touch', id: 1 });
    send('move', [230, 100], { pointerType: 'touch', id: 2 }); // one finger left: still part of the pinch
    send('up', [230, 100], { pointerType: 'touch', id: 2 });
    const relevant = log.filter((l) => !l.startsWith('hover'));
    expect(relevant).toEqual([
      'press 100,100',
      'drag 105,100',
      'dragCancel',
      'pinchStart',
      'pinch 105,100|200,100 -> 90,100|200,100',
      'pinch 105,100|200,100 -> 90,100|220,100',
      'pinchEnd',
    ]);
  });
});

describe('hover', () => {
  it('a mouse with no button down hovers; leaving clears it', () => {
    const { log, send } = setup();
    send('move', [7, 8]);
    send('leave', [7, 8]);
    expect(log).toEqual(['hover 7,8', 'hover null']);
  });

  it('fingers never hover, and lifting one clears any hover', () => {
    const { log, send } = setup();
    send('move', [7, 8], { pointerType: 'touch' });
    send('down', [7, 8], { pointerType: 'touch' });
    send('up', [7, 8], { pointerType: 'touch' });
    expect(log.filter((l) => l.startsWith('hover'))).toEqual(['hover null', 'hover null']);
  });
});
