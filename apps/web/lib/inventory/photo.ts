/**
 * Phone photos, made small enough to send.
 *
 * A phone camera photo is 3-8 MB. A part gets several, the shop tags hundreds,
 * and the stockroom is often on mobile data, so each photo is scaled down to
 * at most 1600 px on its long side and saved as a JPEG before upload: still
 * plenty to read an engine-number stamp, at a tenth of the size.
 *
 * If the browser cannot read the file (an odd format) the original goes as it
 * is, and the server says plainly whether it takes it.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function shrinkPhoto(file: File): Promise<File> {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    // Keep the original when shrinking did not help (a small, already-compressed photo).
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
