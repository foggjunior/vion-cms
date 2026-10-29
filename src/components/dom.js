// DOM construction helpers. User-supplied text is only ever assigned through text nodes / textContent,
// never interpolated into HTML. URL attributes pass through an allowlist.
import { ICON_PATHS } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction']);
const BOOLEAN_PROPS = new Set(['checked', 'disabled', 'hidden', 'selected', 'multiple', 'required', 'readOnly', 'open']);

export function safeUrl(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('#') || text.startsWith('blob:')) return text;
  try {
    const url = new URL(text, location.href);
    return ['http:', 'https:', 'blob:', 'mailto:', 'tel:'].includes(url.protocol) ? text : '#';
  } catch {
    return '#';
  }
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

// h('button', { class: 'x', on: { click } }, 'Label', childNode)
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  let value;
  if (props) {
    for (const [key, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (key === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (key === 'text') el.textContent = v;
      else if (key === 'on') for (const [type, fn] of Object.entries(v)) el.addEventListener(type, fn);
      else if (key === 'dataset') Object.assign(el.dataset, v);
      else if (key === 'ref') v(el);
      else if (key === 'value') value = v;
      else if (BOOLEAN_PROPS.has(key)) el[key] = true;
      else if (URL_ATTRIBUTES.has(key)) el.setAttribute(key, safeUrl(v));
      else el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

export function icon(name, { label } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.file);
  svg.append(path);
  return svg;
}

// Trusted static markup for the dashboard shell (icon names are constants, never user input).
export function iconMarkup(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name] || ICON_PATHS.file}"/></svg>`;
}

export function clear(el) { el.replaceChildren(); return el; }

let liveRegion;
export function announce(message) {
  if (!liveRegion) {
    liveRegion = h('div', { class: 'visually-hidden', 'aria-live': 'polite', role: 'status' });
    document.body.append(liveRegion);
  }
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = message; }, 30);
}

export function button(label, { variant = 'secondary', iconName, onClick, ...rest } = {}) {
  return h('button', { type: 'button', class: ['btn', `btn-${variant}`, rest.class], on: onClick ? { click: onClick } : null, ...omit(rest, ['class']) }, iconName ? icon(iconName) : null, h('span', null, label));
}

export function linkButton(label, href, { variant = 'secondary', iconName, ...rest } = {}) {
  return h('a', { href, class: ['btn', `btn-${variant}`, rest.class], ...omit(rest, ['class']) }, iconName ? icon(iconName) : null, h('span', null, label));
}

function omit(obj, keys) {
  const out = { ...obj };
  for (const key of keys) delete out[key];
  return out;
}

// Plain-text paragraphs rendered safely.
export function textBlocks(text, { className = 'prose' } = {}) {
  const blocks = String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return h('div', { class: className }, blocks.map(p => h('p', null, p)));
}
