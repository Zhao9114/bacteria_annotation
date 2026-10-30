// Work done in the browser before an image is stored: decode it to learn its
// size, hash it (duplicate detection, matching NN predictions later), and make
// a small thumbnail for the library grid.

import type { PreparedImage } from './store';

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];
const THUMB_SIZE = 320;

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`"${file.name}" is not a supported image. Please use PNG, JPEG, WebP, BMP or GIF.`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Could not open "${file.name}". The file may be damaged.`);
  }
  const { width, height } = bitmap;
  const k = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const thumb = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Thumbnail failed'))), 'image/jpeg', 0.82),
  );
  return { file, filename: file.name, mime: file.type, width, height, sha256: await sha256Hex(file), thumb };
}
