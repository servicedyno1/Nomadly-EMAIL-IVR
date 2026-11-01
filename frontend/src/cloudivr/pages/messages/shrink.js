// Shrinks pictures in the browser so a message stays under the carrier limit (about 600 KB in total).
const load = (file) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('That file isn’t a picture we can read.')); img.src = URL.createObjectURL(file); });
const toBlob = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));

export async function shrink(file, budget) {
  if (file.type === 'image/gif' && file.size <= budget) return file;
  const img = await load(file);
  let side = 1600, q = 0.82, blob = file.size <= budget && file.type !== 'image/heic' ? file : null;
  while (!blob || blob.size > budget) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    blob = await toBlob(c, q);
    if (side < 300) break;
    side = Math.round(side * 0.8); q = Math.max(0.5, q - 0.08);
  }
  URL.revokeObjectURL(img.src);
  return blob.size === file.size && blob === file ? file : new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}
