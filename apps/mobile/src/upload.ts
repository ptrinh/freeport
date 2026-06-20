/**
 * NIP-96 image upload.
 *
 * nostr.build exposes a standard NIP-96 endpoint. We POST the image as
 * multipart/form-data and get back a JSON body with `nip94_event.tags`
 * containing an `url` entry — that URL is what goes in the intent payload.
 *
 * The server requires NIP-98 HTTP auth: a signed kind-27235 event for this
 * exact URL+method, base64-encoded in the Authorization header. We sign it
 * with the user's existing identity key — no separate account needed.
 * Docs: https://github.com/nostr-protocol/nips/blob/master/96.md (NIP-96)
 *       https://github.com/nostr-protocol/nips/blob/master/98.md (NIP-98)
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { getToken } from 'nostr-tools/nip98';
import { loadOrCreateKey } from './identity';

const UPLOAD_URL = 'https://nostr.build/api/v2/upload/files';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard limit from nostr.build

export class UploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/** What expo-image-picker gives us per asset; we honor its real type/name. */
export interface PickedImage {
  uri: string;
  mimeType?: string;
  fileName?: string | null;
}

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
};
const MIME_FOR_EXT: Record<string, string> = {
  png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

/**
 * Upload a picked image (from expo-image-picker) to nostr.build. Accepts a
 * bare URI or the asset object — the asset carries the real `mimeType`, which
 * matters on web where the picker hands back a `data:`/`blob:` URI with no
 * filename extension. We pick the mime from (asset.mimeType → fileName ext →
 * URI ext → jpeg) so PNGs (and gif/webp) upload correctly instead of being
 * mislabeled as JPEG. On web we fetch the URI into a real Blob so the bytes +
 * type reach the server (the RN {uri,name,type} shape doesn't carry bytes there).
 */
export async function uploadImage(input: string | PickedImage): Promise<string> {
  const asset: PickedImage = typeof input === 'string' ? { uri: input } : input;
  const { uri } = asset;
  const nameExt = asset.fileName?.split('.').pop()?.toLowerCase();
  const uriExt = uri.split('?')[0].split('.').pop()?.toLowerCase();
  const mimeType =
    asset.mimeType ||
    (nameExt && MIME_FOR_EXT[nameExt]) ||
    (uriExt && MIME_FOR_EXT[uriExt]) ||
    'image/jpeg';
  const ext = EXT_FOR_MIME[mimeType] ?? 'jpg';
  const filename = asset.fileName?.includes('.') ? asset.fileName : `freeport-${Date.now()}.${ext}`;

  const form = new FormData();
  if (uri.startsWith('data:') || uri.startsWith('blob:')) {
    // Web: turn the data/blob URI into a real File so bytes + mime are sent.
    const blob = await (await fetch(uri)).blob();
    form.append('file', new File([blob], filename, { type: mimeType }));
  } else {
    // Native: React Native FormData accepts the {uri, name, type} object shape.
    form.append('file', { uri, name: filename, type: mimeType } as any);
  }
  return postForm(form);
}

/**
 * Upload any file (e.g. a voice memo) to nostr.build. `file` is a local URI
 * string (native, expo-av/file) or a Blob (web, MediaRecorder). Returns the
 * public HTTPS URL.
 */
export async function uploadFile(file: string | Blob, filename: string, mimeType: string): Promise<string> {
  const form = new FormData();
  if (typeof file === 'string') {
    form.append('file', { uri: file, name: filename, type: mimeType } as any);
  } else {
    form.append('file', file, filename); // web: Blob/File
  }
  return postForm(form);
}

async function postForm(form: FormData): Promise<string> {
  // NIP-98 auth: signed kind-27235 event for this URL+method
  let authHeader: string;
  try {
    const sk = await loadOrCreateKey();
    authHeader = await getToken(UPLOAD_URL, 'POST', (e) => finalizeEvent(e, sk), true);
  } catch (e) {
    throw new UploadError(`Auth error: ${(e as Error).message}`);
  }

  let resp: Response;
  try {
    resp = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: form,
    });
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
    throw new UploadError('Unexpected response from upload server');
  }

  // Standard NIP-96 shape: { nip94_event: { tags: [['url', '<url>'], ...] } }
  // nostr.build APIv2 shape:  { status: 'success', data: [{ url: '<url>', ... }] }
  const tags: string[][] = json?.nip94_event?.tags ?? [];
  const url = tags.find((t) => t[0] === 'url')?.[1] ?? json?.data?.[0]?.url;
  if (typeof url !== 'string' || !url) throw new UploadError(json?.message ?? 'No URL in server response');
  return url;
}
