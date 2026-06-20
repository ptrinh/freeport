/**
 * Web has no iCloud Keychain / Google Block Store, so every cloud-backup call is
 * a no-op and `cloudAvailable()` is false — the UI keeps the file-only flow.
 */
export function cloudAvailable(): boolean {
  return false;
}

export async function cloudSave(_nsec: string | null): Promise<boolean> {
  return false;
}

export async function cloudRestore(): Promise<string | null> {
  return null;
}

export async function cloudClear(): Promise<void> {
  /* no-op */
}

export function cloudName(): string {
  return '';
}
