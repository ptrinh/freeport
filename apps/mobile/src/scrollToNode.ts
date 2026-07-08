/**
 * Scroll a registered field node into view — the visual cue behind
 * "Publish blocked by a missing field" (useRequiredFields in App.tsx).
 *
 * Platform split, extracted so it's unit-testable:
 *  - web: the react-native-web (≥0.19) View ref IS the DOM element; use its
 *    scrollIntoView directly. findNodeHandle must NEVER be called here — RNW
 *    0.21 throws "findNodeHandle is not supported on web", which crashed the
 *    publish flow in production (GlitchTip FREEPORT-1).
 *  - native: resolve the ScrollView's handle (injected findHandle →
 *    findNodeHandle) and measureLayout the node against it, then scrollTo
 *    slightly above the field.
 *
 * Never throws: this is a best-effort cue — the field's pulse animation fires
 * regardless.
 */
export interface ScrollableNode {
  scrollIntoView?: (opts?: unknown) => void;
  measureLayout?: (
    parentHandle: unknown,
    onSuccess: (x: number, y: number) => void,
    onFail: () => void,
  ) => void;
}

export interface ScrollContainer {
  scrollTo: (opts: { y: number; animated: boolean }) => void;
}

export function scrollNodeIntoView(
  node: ScrollableNode | null,
  scrollView: ScrollContainer | null | undefined,
  opts: { isWeb: boolean; findHandle: (scrollView: ScrollContainer) => unknown },
): void {
  if (!node) return;
  if (opts.isWeb) {
    try { node.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch { /* pulse still fires */ }
    return;
  }
  if (!scrollView) return;
  let handle: unknown;
  try { handle = opts.findHandle(scrollView); } catch { return; }
  if (handle == null) return;
  try {
    node.measureLayout?.(
      handle,
      (_x, y) => scrollView.scrollTo({ y: Math.max(0, y - 24), animated: true }),
      () => {},
    );
  } catch { /* measureLayout unsupported here — the pulse still fires */ }
}
