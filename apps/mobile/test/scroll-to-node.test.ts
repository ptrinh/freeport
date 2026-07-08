/**
 * Regression tests for GlitchTip FREEPORT-1: tapping Publish with a missing
 * required field crashed the WEB app, because the scroll-into-view cue called
 * findNodeHandle — which react-native-web 0.21 makes throw unconditionally
 * ("findNodeHandle is not supported on web"). The web path must use the DOM
 * ref directly and never touch findNodeHandle; the native path keeps the
 * findNodeHandle + measureLayout + scrollTo flow. Never throws either way.
 */
import { describe, it, expect, vi } from 'vitest';
import { scrollNodeIntoView, type ScrollableNode, type ScrollContainer } from '../src/scrollToNode';

/** findNodeHandle exactly as react-native-web 0.21 implements it. */
const rnwFindNodeHandle = () => {
  throw new Error('findNodeHandle is not supported on web. Use the ref property on the component instead.');
};

const sv = (): ScrollContainer & { scrollTo: ReturnType<typeof vi.fn> } => ({ scrollTo: vi.fn() });

describe('web (the production crash)', () => {
  it('scrolls via the DOM ref and NEVER calls findNodeHandle', () => {
    const scrollIntoView = vi.fn();
    const findHandle = vi.fn(rnwFindNodeHandle);
    scrollNodeIntoView({ scrollIntoView }, sv(), { isWeb: true, findHandle });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(findHandle).not.toHaveBeenCalled(); // calling it = the FREEPORT-1 crash
  });

  it('does not throw even with RNW-style throwing findNodeHandle and no scrollIntoView', () => {
    expect(() =>
      scrollNodeIntoView({} as ScrollableNode, sv(), { isWeb: true, findHandle: rnwFindNodeHandle }),
    ).not.toThrow();
  });

  it('swallows a throwing scrollIntoView (cue is best-effort, pulse still fires)', () => {
    expect(() =>
      scrollNodeIntoView(
        { scrollIntoView: () => { throw new Error('detached node'); } },
        sv(),
        { isWeb: true, findHandle: rnwFindNodeHandle },
      ),
    ).not.toThrow();
  });

  it('missing scroll container is fine on web (DOM scrolls the page itself)', () => {
    const scrollIntoView = vi.fn();
    scrollNodeIntoView({ scrollIntoView }, null, { isWeb: true, findHandle: rnwFindNodeHandle });
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe('native', () => {
  it('measures against the ScrollView handle and scrolls 24px above the field', () => {
    const container = sv();
    const node: ScrollableNode = {
      measureLayout: (handle, onSuccess) => {
        expect(handle).toBe('handle-1');
        onSuccess(0, 300);
      },
    };
    scrollNodeIntoView(node, container, { isWeb: false, findHandle: () => 'handle-1' });
    expect(container.scrollTo).toHaveBeenCalledWith({ y: 276, animated: true });
  });

  it('clamps the scroll target at 0 for fields near the top', () => {
    const container = sv();
    const node: ScrollableNode = { measureLayout: (_h, ok) => ok(0, 10) };
    scrollNodeIntoView(node, container, { isWeb: false, findHandle: () => 1 });
    expect(container.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('no-ops when the handle resolves to null', () => {
    const container = sv();
    scrollNodeIntoView({ measureLayout: vi.fn() }, container, { isWeb: false, findHandle: () => null });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('no-ops without a scroll container', () => {
    expect(() =>
      scrollNodeIntoView({ measureLayout: vi.fn() }, undefined, { isWeb: false, findHandle: () => 1 }),
    ).not.toThrow();
  });

  it('swallows findHandle/measureLayout failures', () => {
    const container = sv();
    expect(() =>
      scrollNodeIntoView({ measureLayout: vi.fn() }, container, { isWeb: false, findHandle: () => { throw new Error('gone'); } }),
    ).not.toThrow();
    expect(() =>
      scrollNodeIntoView(
        { measureLayout: () => { throw new Error('unsupported'); } },
        container,
        { isWeb: false, findHandle: () => 1 },
      ),
    ).not.toThrow();
  });

  it('no node registered → no-op', () => {
    expect(() => scrollNodeIntoView(null, sv(), { isWeb: false, findHandle: () => 1 })).not.toThrow();
  });
});
