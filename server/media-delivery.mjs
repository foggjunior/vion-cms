// Display delivery for CMS images. The editor asks for a width; the server answers with a short-lived
// redirect to a resized Cloudinary rendition instead of streaming the full original through Next.
// Only a few fixed widths are offered so the number of derived Cloudinary images stays small.
export const DISPLAY_WIDTHS = Object.freeze([480, 1000, 1600]);

export function displayWidth(requested) {
  const width = Number(requested);
  if (!requested || !Number.isFinite(width) || width <= 0) return null;
  return DISPLAY_WIDTHS.find(size => size >= width) || DISPLAY_WIDTHS.at(-1);
}

export function storedImageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw Error('Invalid stored image host.');
  return url;
}

// https://res.cloudinary.com/<cloud>/image/upload/v1/vion-cms/<id>.jpg
//   → https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto,c_limit,w_480/v1/vion-cms/<id>.jpg
// c_limit never enlarges a smaller original. Unrecognised paths are returned unchanged.
export function deliveryUrl(value, width) {
  const url = storedImageUrl(value);
  const match = url.pathname.match(/^(\/[^/]+\/image\/upload\/)(.+)$/);
  if (!match || !DISPLAY_WIDTHS.includes(width)) return url.href;
  return url.origin + match[1] + 'f_auto,q_auto,c_limit,w_' + width + '/' + match[2];
}
