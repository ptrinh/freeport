/**
 * NIP-96 image upload.
 *
 * nostr.build exposes a standard NIP-96 endpoint. We POST the image as
 * multipart/form-data and get back a JSON body with `nip94_event.tags`
 * containing an `url` entry — that URL is what goes in the intent payload.
 *
 * No API key required for public uploads. Images are public and permanent.
 * Docs: https://github.com/nostr-protocol/nips/blob/master/96.md
 */

const UPLOAD_URL = 'https://nostr.build/api/v2/upload/files';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard limit from nostr.build

export class UploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/**
 * Upload a local file URI (from expo-image-picker) to nostr.build.
 * Returns the public HTTPS URL of the uploaded file.
 */
export async function uploadImage(localUri: string): Promise<string> {
  // Derive a filename from the URI (last path segment) or fall back to a
  // timestamp-based name. nostr.build infers mime type from the extension.
  const filename = localUri.split('/').pop() ?? `freeport-${Date.now()}.jpg`;
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const form = new FormData();
  // React Native FormData accepts the {uri, name, type} object shape.
  form.append('file', { uri: localUri, name: filename, type: mimeType } as any);

  let resp: Response;
  try {
    resp = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  } catch (e) {
    throw new UploadError(`Network error: ${(e as Error).message}`);
  }

  if (!resp.ok) {
    throw new UploadError(`Upload failed (HTTP ${resp.status})`, resp.status);
  }

  let json: any;
  try {
    json = await resp.json();
  } catch {
    throw new UploadError('Unexpected response from image server');
  }

  // NIP-96 success response shape:
  // { status: 'success', nip94_event: { tags: [['url', '<url>'], ...] } }
  const tags: string[][] = json?.nip94_event?.tags ?? [];
  const url = tags.find((t) => t[0] === 'url')?.[1];
  if (!url) throw new UploadError('No URL in server response');
  return url;
}
