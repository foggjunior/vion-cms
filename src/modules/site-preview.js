// Read-only renderers for site settings and team profiles (saved drafts or published snapshots). All text is
// inserted as text nodes; every link is re-checked here (https-only, tel:/mailto: built from validated values)
// so an unsafe stored value is shown as plain text instead of becoming a link.
import { h, icon } from '../components/dom.js';
import { assetImage } from '../components/media.js';
import { BUNDLED_LOGOS } from './shared/site.js';
import { mailtoHref, safeHttpsHref, telHref } from './shared/site-validation.js';
import { paragraphs, truncateWords } from './shared/format.js';

const prose = text => h('div', { class: 'prose' }, paragraphs(text).map(p => h('p', null, p)));
const external = (url, label, className) => {
  const href = safeHttpsHref(url);
  return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: className }, label) : h('span', { class: 'muted' }, `${label} (link not shown: not a safe https:// address)`);
};
const phoneLink = phone => { const href = telHref(phone); return href ? h('a', { href }, phone) : h('span', null, phone); };
const emailLink = email => { const href = mailtoHref(email); return href ? h('a', { href }, email) : h('span', null, email); };

export function logoImage(logo, { scope, assets, className = 'logo-img' }) {
  if (!logo) return null;
  if (logo.source === 'bundled') {
    const bundled = BUNDLED_LOGOS[logo.key];
    return bundled ? h('img', { class: className, src: bundled.src, alt: logo.alt || '' }) : h('span', { class: 'msg-error' }, 'Unknown bundled logo');
  }
  return assetImage(scope, logo.assetId, { alt: logo.alt || '', className, asset: assets.get(logo.assetId) });
}

// Company/contact summary card.
export function companySummary(s, { scope, assets }) {
  const { company: c, contact: k } = s;
  const rows = [
    ['Company', c.name], ['Tagline', c.tagline], ['Office address', c.officeAddress ? h('span', { class: 'pre-line' }, c.officeAddress) : ''],
    ['Timezone', c.timezone], ['Areas served', c.areasServed.join(', ')],
    ['Primary telephone', k.primaryPhone ? phoneLink(k.primaryPhone) : ''], ['Emergency telephone', k.emergencyPhone ? phoneLink(k.emergencyPhone) : ''],
    ['Phone support', k.phoneSupportNote], ['Public email', k.email ? emailLink(k.email) : ''], ['Email response', k.emailResponseNote],
    ['Map', k.mapsUrl ? external(k.mapsUrl, 'View on Google Maps') : '']
  ];
  return h('section', { class: 'company-summary' },
    h('div', { class: 'company-summary-head' }, logoImage(s.branding.logoLight || s.branding.logoDark, { scope, assets }), h('h2', null, c.name || 'Company name not set')),
    h('dl', { class: 'seo-dl' }, rows.flatMap(([label, value]) => [h('dt', null, label), h('dd', null, value || h('span', { class: 'muted' }, 'Not provided'))])));
}

// Footer-style block: branding, description, contact, social and review links.
export function footerPreview(s, { scope, assets }) {
  const { company: c, contact: k, branding: b } = s;
  const logo = b.logoDark || b.logoLight;
  const socials = s.social.filter(x => x.visible && x.network && x.url);
  const reviews = s.reviews.filter(r => r.visible && r.platform && r.url);
  return h('footer', { class: ['site-footer', b.logoDark ? 'is-dark' : 'is-light'] },
    h('div', { class: 'site-footer-grid' },
      h('div', null,
        logo ? logoImage(logo, { scope, assets, className: 'footer-logo' }) : h('p', { class: 'muted' }, 'No logo chosen.'),
        c.tagline ? h('p', { class: 'footer-tagline' }, c.tagline) : null,
        c.footerDescription ? prose(c.footerDescription) : null),
      h('div', null, h('h3', null, 'Contact'),
        k.primaryPhone ? h('p', null, 'Tel: ', phoneLink(k.primaryPhone)) : null,
        k.emergencyPhone ? h('p', null, 'Emergency: ', phoneLink(k.emergencyPhone)) : null,
        k.phoneSupportNote ? h('p', { class: 'small pre-line' }, k.phoneSupportNote) : null,
        k.email ? h('p', null, 'Email: ', emailLink(k.email)) : null,
        k.emailResponseNote ? h('p', { class: 'small pre-line' }, k.emailResponseNote) : null,
        c.officeAddress ? h('p', { class: 'pre-line' }, c.officeAddress) : null,
        k.mapsUrl ? h('p', null, external(k.mapsUrl, 'View on Google Maps')) : null,
        !k.primaryPhone && !k.email && !c.officeAddress ? h('p', { class: 'muted' }, 'No contact details provided.') : null),
      h('div', null, h('h3', null, 'Follow'),
        socials.length ? h('ul', { class: 'footer-links' }, socials.map(x => h('li', null, external(x.url, x.network)))) : h('p', { class: 'muted' }, 'No visible social profiles.'),
        c.areasServed.length ? h('p', { class: 'small' }, 'Areas served: ', c.areasServed.join(', ')) : null),
      h('div', null, h('h3', null, 'Reviews'),
        reviews.length ? h('ul', { class: 'footer-reviews' }, reviews.map(r => h('li', null, h('strong', null, r.platform), r.description ? h('p', { class: 'small pre-line' }, r.description) : null, external(r.url, r.buttonLabel || 'View', 'btn btn-secondary')))) : h('p', { class: 'muted' }, 'No visible review links.'))),
    h('p', { class: 'footer-note' }, c.name ? `© ${c.name}` : ''));
}

// Explicit bundled fallback when there are no published settings. No business details are invented.
export function fallbackFooter() {
  const bundled = Object.values(BUNDLED_LOGOS)[0];
  return h('footer', { class: 'site-footer is-light' },
    h('div', { class: 'site-footer-grid' },
      h('div', null, h('img', { class: 'footer-logo', src: bundled.src, alt: bundled.defaultAlt }), h('p', { class: 'small muted' }, 'Bundled logo shown as an explicit fallback.')),
      h('div', null, h('h3', null, 'No published site settings'), h('p', { class: 'muted' }, 'Company, contact, social and review details appear here after Site settings are published locally. Nothing is assumed in the meantime.'))));
}

// Local metadata preview built from default SEO settings. It never claims production SEO has changed.
export function seoMetadataPreview(s, { scope, assets, pageTitle = 'Example page title' }) {
  const b = s.branding;
  const shareImage = b.shareImage ? assetImage(scope, b.shareImage.assetId, { alt: b.shareImage.alt || '', className: 'share-thumb', asset: assets.get(b.shareImage.assetId) })
    : b.shareImageUsesLogo && b.logoLight?.source === 'asset' ? assetImage(scope, b.logoLight.assetId, { alt: '', className: 'share-thumb', asset: assets.get(b.logoLight.assetId) }) : null;
  const title = [pageTitle, s.seo.titleSuffix].filter(Boolean).join(' ');
  return h('div', { class: 'seo-preview' },
    h('p', { class: 'seo-route' }, s.seo.siteName || s.company.name || '(no site name)'),
    h('p', { class: 'seo-title' }, title),
    h('p', { class: 'seo-desc' }, s.seo.defaultDescription ? truncateWords(s.seo.defaultDescription, 200) : 'No default description.'),
    h('dl', { class: 'seo-dl' },
      h('dt', null, 'Site name'), h('dd', null, s.seo.siteName || '—'),
      h('dt', null, 'Title format'), h('dd', null, s.seo.titleSuffix ? `Page title ${s.seo.titleSuffix}` : 'Page title (no suffix)'),
      h('dt', null, 'Sharing image'), h('dd', null, shareImage || h('span', { class: 'muted' }, 'None chosen')),
      h('dt', null, 'Sharing image source'), h('dd', null, b.shareImage ? 'Default sharing image' : b.shareImageUsesLogo ? 'Approved logo fallback' : 'None')),
    h('p', { class: 'field-hint' }, 'Local preview only. Production metadata and the live website are not fetched or changed.'));
}

// ---- team ----
export function portraitImage(member, { scope, assets, className = 'portrait-img' }) {
  return member.portrait
    ? assetImage(scope, member.portrait.assetId, { alt: member.portrait.alt || '', className, asset: assets.get(member.portrait.assetId) })
    : h('div', { class: ['img-box', 'img-missing', className] }, icon('users'), h('span', null, 'No portrait'));
}

export function teamCard(member, { scope, assets, href, flags = [] }) {
  const inner = [
    portraitImage(member, { scope, assets }),
    h('div', { class: 'card-body' },
      h('h3', null, member.name),
      member.position ? h('p', null, member.position) : null,
      flags.length ? h('p', { class: 'badge-row' }, flags.map(f => h('span', { class: `status-badge status-${f.tone}` }, f.text))) : null)
  ];
  return href ? h('a', { class: 'preview-card team-card', href }, inner) : h('div', { class: 'preview-card team-card' }, inner);
}

export function teamGrid(items, { scope, assets, empty }) {
  return items.length ? h('div', { class: 'card-grid team-grid' }, items.map(item => teamCard(item.member, { scope, assets, href: item.href, flags: item.flags })))
    : h('div', { class: 'empty-state panel' }, h('span', null, icon('users')), h('strong', null, 'No profiles to show'), h('p', null, empty));
}

export function memberPage(member, { scope, assets }) {
  const links = (member.links || []).filter(l => l.url);
  return h('article', { class: 'preview-page member-page' },
    h('div', { class: 'member-head' },
      portraitImage(member, { scope, assets, className: 'member-portrait' }),
      h('header', { class: 'preview-head' }, h('p', { class: 'eyebrow' }, 'TEAM'), h('h1', null, member.name), member.position ? h('p', { class: 'lead' }, member.position) : null)),
    h('section', { class: 'preview-section' }, h('h2', null, 'Biography'), member.bio ? prose(member.bio) : h('p', { class: 'muted' }, 'No biography yet.')),
    links.length ? h('section', { class: 'preview-section' }, h('h2', null, 'Links'), h('ul', { class: 'preview-list' }, links.map(l => h('li', null, external(l.url, l.label || l.url))))) : null);
}
