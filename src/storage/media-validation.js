// Upload inspection: sniffs real file content, rejects SVG and unsupported types, enforces the size
// limit and proves the image decodes before anything is stored.
import { formatBytes } from '../modules/shared/format.js';
import { LOW_RESOLUTION_WIDTH } from '../modules/shared/validation.js';

// Proposed limits from the specification; adjust here.
export const MEDIA_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'], lowResolutionWidth: LOW_RESOLUTION_WIDTH });
export const ACCEPT_ATTRIBUTE = MEDIA_LIMITS.allowedTypes.join(',');

export async function sniffImageType(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg')) || text.startsWith('<!doctype svg')) return 'image/svg+xml';
  return null;
}

async function decodeDimensions(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Returns { ok, errors, warnings, info: { fileName, type, size, width, height }, blob }.
export async function inspectImageFile(file, limits = MEDIA_LIMITS) {
  const fileName = file.name || 'image';
  const errors = [];
  const warnings = [];
  const declared = (file.type || '').toLowerCase();
  if (declared === 'image/svg+xml' || /\.svgz?$/i.test(fileName)) {
    return { ok: false, errors: ['SVG files are not accepted for uploads because they can contain scripts. Export the image as JPEG, PNG or WebP.'], warnings, info: { fileName } };
  }
  if (!file.size) return { ok: false, errors: ['The file is empty.'], warnings, info: { fileName } };
  if (file.size > limits.maxBytes) errors.push(`The file is ${formatBytes(file.size)}; the upload limit is ${formatBytes(limits.maxBytes)}. Resize or compress it first.`);
  const type = await sniffImageType(file);
  if (type === 'image/svg+xml') return { ok: false, errors: ['SVG content is not accepted for uploads because it can contain scripts. Export the image as JPEG, PNG or WebP.'], warnings, info: { fileName } };
  if (!type || !limits.allowedTypes.includes(type)) {
    errors.push('This file is not a JPEG, PNG or WebP image. Only those formats can be uploaded.');
    return { ok: false, errors, warnings, info: { fileName, size: file.size } };
  }
  if (declared && declared !== type) warnings.push(`The file is labelled ${declared} but contains ${type}; it will be stored as ${type}.`);
  let dimensions;
  try {
    dimensions = await decodeDimensions(file);
  } catch {
    errors.push('The image could not be decoded. It may be corrupt or incomplete — re-export it and try again.');
  }
  if (dimensions && (!dimensions.width || !dimensions.height)) errors.push('The image has no usable dimensions.');
  if (dimensions?.width && dimensions.width < limits.lowResolutionWidth) {
    warnings.push(`Low resolution: ${dimensions.width} × ${dimensions.height}px. Images at least ${limits.lowResolutionWidth}px wide are recommended (advisory).`);
  }
  const info = { fileName, type, size: file.size, width: dimensions?.width || 0, height: dimensions?.height || 0 };
  const blob = declared === type ? file : new Blob([file], { type });
  return { ok: errors.length === 0, errors, warnings, info, blob };
}

// Large camera photos are resized in the browser before a shared-workspace upload, so the transfer and
// the server's verification handle far fewer bytes. The long edge is kept at 2560px (still well above
// the 1200px recommendation). Smaller files are returned unchanged, as is anything the browser cannot
// re-encode or that would not get smaller. Orientation is applied from the photo's EXIF data and other
// metadata (such as GPS position) is not carried over.
export const UPLOAD_MAX_EDGE = 2560;
export const UPLOAD_OPTIMIZE_BYTES = 2.5 * 1024 * 1024;

export async function optimizeForUpload(inspected, { maxEdge = UPLOAD_MAX_EDGE, minBytes = UPLOAD_OPTIMIZE_BYTES } = {}) {
  const { info, blob } = inspected || {};
  if (!inspected?.ok || !blob || typeof createImageBitmap !== 'function') return inspected;
  if (Math.max(info.width, info.height) <= maxEdge && blob.size <= minBytes) return inspected;
  let bitmap;
  try {
    try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch { bitmap = await createImageBitmap(blob); }
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    // JPEG stays JPEG; PNG and WebP become WebP, which keeps transparency.
    const type = info.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const output = canvas.convertToBlob
      ? await canvas.convertToBlob({ type, quality: 0.86 })
      : await new Promise(resolve => canvas.toBlob(resolve, type, 0.86));
    if (!output || output.type !== type || output.size >= blob.size) return inspected;
    const fileName = type === info.type ? info.fileName : info.fileName.replace(/\.[^.]*$/, '') + '.webp';
    return { ...inspected, blob: output, info: { ...info, fileName, type, size: output.size, width, height } };
  } catch {
    return inspected;
  } finally {
    bitmap?.close?.();
  }
}
