/**
 * SwipeableRow drag-suppression guard (ui/SwipeableRow.tsx).
 *
 * NOTE: this repo has no component-test harness (vitest runs the `node`
 * environment, react-test-renderer is not a dependency, and no other ui/*
 * component is tested). So rather than render the component, this is a focused
 * logic test of the two pieces the guard is built from — the PanResponder
 * grant predicate and the beginDrag/endDrag → `dragging` timer state machine —
 * modeled exactly as in SwipeableRow.tsx (SLOP = 12, 120 ms restore delay,
 * pointerEvents = dragging ? 'none' : 'auto'). If the component logic changes,
 * update this mirror.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SLOP = 12;

/** onMoveShouldSetPanResponder: a horizontal-dominant move past the slop. */
const grantsResponder = (dx: number, dy: number) =>
  Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 1.5;

/** Mirror of the dragging + clearTimer state machine (beginDrag/endDrag). */
function makeDragGuard() {
  let dragging = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    pointerEvents: () => (dragging ? 'none' : 'auto'),
    isDragging: () => dragging,
    beginDrag() {
      if (timer) { clearTimeout(timer); timer = null; }
      dragging = true;
    },
    endDrag() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { dragging = false; timer = null; }, 120);
    },
  };
}

describe('grant predicate (which touches become a drag)', () => {
  it('grants on a horizontal-dominant move past the slop', () => {
    expect(grantsResponder(20, 3)).toBe(true);
  });
  it('does not grant a small move (a tap)', () => {
    expect(grantsResponder(5, 0)).toBe(false);
  });
  it('does not grant a vertical-dominant move (scroll passes through)', () => {
    expect(grantsResponder(20, 30)).toBe(false);
  });
});

describe('dragging guard → pointerEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a drag sets pointerEvents 'none', and it restores to 'auto' after 120ms", () => {
    const g = makeDragGuard();
    expect(g.pointerEvents()).toBe('auto'); // idle
    g.beginDrag();
    expect(g.pointerEvents()).toBe('none'); // touch owned by the responder
    g.endDrag();
    expect(g.pointerEvents()).toBe('none'); // still suppressed just after release
    vi.advanceTimersByTime(119);
    expect(g.pointerEvents()).toBe('none'); // web's post-drag click window
    vi.advanceTimersByTime(1);
    expect(g.pointerEvents()).toBe('auto'); // restored
  });

  it('a re-drag before the 120ms delay cancels the pending restore', () => {
    const g = makeDragGuard();
    g.beginDrag();
    g.endDrag();
    vi.advanceTimersByTime(100);
    g.beginDrag(); // re-swipe cancels the scheduled setDragging(false)
    vi.advanceTimersByTime(100);
    expect(g.isDragging()).toBe(true); // still dragging — old timer was cleared
  });

  it('a plain tap path (predicate never grants) never sets dragging', () => {
    const g = makeDragGuard();
    // A tap on a closed row: grant predicate is false, so beginDrag is never
    // called and the pointerEvents wrapper stays interactive.
    expect(grantsResponder(4, 1)).toBe(false);
    expect(g.pointerEvents()).toBe('auto');
  });
});
