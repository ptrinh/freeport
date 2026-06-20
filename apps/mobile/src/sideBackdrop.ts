/**
 * Native no-op. On phones the app fills the whole screen, so there are no blank
 * side margins to decorate. The web build swaps in sideBackdrop.web.ts.
 */
export function applySideBackdrop(_stroke: string, _seed = ''): void {}
