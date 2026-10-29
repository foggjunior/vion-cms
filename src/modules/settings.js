// Site settings module (Settings › Setting Options): one singleton record with company, contact, branding,
// social, review-link and default-SEO fields. Unknown details stay empty; nothing is pre-filled except the
// specified default timezone. Publishing updates the local preview only.
import { append, button, clear, h, icon } from '../components/dom.js';
import { confirmDialog } from '../components/dialog.js';
import { notice } from '../components/feedback.js';
import { fieldIdFor } from '../components/fields.js';
import { createRepeater } from '../components/repeater.js';
import { assetImage, assetSummary, coverField } from '../components/media.js';
import { BUNDLED_LOGOS, SETTINGS_ID, SOCIAL_NETWORK_SUGGESTIONS, formToSettings, newReviewLink, newSettings, newSocialProfile, settingsToForm } from './shared/site.js';
import { SITE_NAME_ADVICE, timeZoneSuggestions, validateSettingsDraft, validateSettingsPublish } from './shared/site-validation.js';
import { SEO_DESCRIPTION_ADVICE } from './shared/validation.js';
import { seoMetadataPreview } from './site-preview.js';

const errorSlot = path => h('p', { class: 'field-error', id: `${fieldIdFor(path)}-error`, hidden: true });

function company(ed) {
  return [
    h('p', { class: 'section-intro' }, 'Leave anything you do not know empty — drafts may be incomplete, and nothing is published until you choose Publish.'),
    ed.group(null,
      ed.text('company.name', { label: 'Company name', required: 'publish' }),
      ed.text('company.tagline', { label: 'Tagline (optional)' }),
      ed.text('company.footerDescription', { label: 'Footer description (optional)', multiline: true, rows: 3, hint: 'Plain text. Shown in the footer preview.' }),
      ed.text('company.officeAddress', { label: 'Office address', required: 'publish', multiline: true, rows: 3, hint: 'Plain text; line breaks are kept.' }),
      ed.text('company.timezone', { label: 'Timezone', required: 'publish', list: 'timezone-options', hint: 'IANA timezone name. Default Africa/Dar_es_Salaam. CMS timestamps are still shown in EAT.' }),
      ed.list('company.areasServed', { label: 'Areas served (optional)', noun: 'area', placeholder: 'e.g. Northern Tanzania', hint: 'Ordered list. Exact duplicates are removed on save.' })),
    h('datalist', { id: 'timezone-options' }, timeZoneSuggestions().map(zone => h('option', { value: zone })))
  ];
}

function contact(ed) {
  return [
    notice('info', 'Public contact details only. Do not enter staff personal numbers or private notification recipients here.'),
    ed.group('Telephone',
      ed.text('contact.primaryPhone', { label: 'Primary telephone', required: 'publish', inputmode: 'tel', placeholder: '+255 …', hint: 'International format recommended. 7–15 digits; spaces, brackets and hyphens allowed. Used for tap-to-call links.' }),
      ed.text('contact.emergencyPhone', { label: 'Emergency telephone (optional)', inputmode: 'tel', hint: 'Only if there is a separate emergency line.' }),
      ed.text('contact.phoneSupportNote', { label: 'Phone-support note (optional)', multiline: true, rows: 2, placeholder: 'e.g. when the phone line is answered' })),
    ed.group('Email',
      ed.text('contact.email', { label: 'Public email', required: 'publish', inputmode: 'email' }),
      ed.text('contact.emailResponseNote', { label: 'Email-response note (optional)', multiline: true, rows: 2, placeholder: 'e.g. how quickly emails are answered' })),
    ed.group('Map',
      ed.text('contact.mapsUrl', { label: 'Google Maps link (optional)', inputmode: 'url', placeholder: 'https://maps.app.goo.gl/…', hint: 'Must be an https:// Google Maps address.' }))
  ];
}

// Logo slot: a library image (JPEG/PNG/WebP) or a bundled trusted logo suitable for this background.
function logoField(ed, key, { label, background, hint }) {
  const path = `branding.${key}`;
  const id = fieldIdFor(path);
  const altId = fieldIdFor(`${path}.alt`);
  const branding = ed.model.branding;
  const bundled = Object.entries(BUNDLED_LOGOS).filter(([, b]) => b.backgrounds.includes(background));
  const container = h('div', { class: 'field field-wide media-field' });
  const set = logo => { branding[key] = logo; ed.changed(); render(); container.querySelector(`#${altId}`)?.focus(); };
  async function chooseAsset() {
    const picked = await ed.pick({ multiple: false, title: `Choose ${label.toLowerCase()}` });
    if (picked?.length) set({ source: 'asset', assetId: picked[0].id, alt: branding[key]?.alt || picked[0].alt || '' });
  }
  const bundledButtons = current => bundled.filter(([k]) => current?.key !== k).map(([k, b]) => button('Use bundled Vion logo', { iconName: 'image', title: b.label, onClick: () => set({ source: 'bundled', key: k, alt: branding[key]?.alt || b.defaultAlt }) }));
  function render() {
    clear(container);
    const logo = branding[key];
    append(container, [h('span', { class: 'field-label' }, label), hint ? h('p', { class: 'field-hint' }, hint) : null]);
    if (!logo) {
      container.append(h('div', { class: 'media-empty' }, icon('image'), h('p', null, 'No logo selected.'),
        ed.readOnly ? null : h('div', { class: 'btn-row' }, button('Choose or upload logo', { iconName: 'upload', id, onClick: chooseAsset, 'aria-describedby': `${id}-error` }), bundledButtons(null))));
    } else {
      const info = logo.source === 'bundled' ? BUNDLED_LOGOS[logo.key] : null;
      const asset = logo.source === 'asset' ? ed.ctx.assets.get(logo.assetId) : null;
      container.append(h('div', { class: 'media-card' },
        h('div', { class: `logo-swatch logo-swatch-${background}` },
          info ? h('img', { src: info.src, alt: logo.alt }) : logo.source === 'asset' ? assetImage(ed.scope, logo.assetId, { alt: logo.alt, asset }) : h('span', { class: 'msg-error' }, 'Unknown bundled logo')),
        h('div', { class: 'media-card-body' },
          info ? h('p', { class: 'asset-meta' }, h('strong', null, info.label), ` · ${info.note}. A trusted static file shipped with the CMS, not an upload.`) : assetSummary(asset),
          h('div', { class: 'field' },
            h('label', { for: altId, class: 'field-label' }, 'Alt text', h('span', { class: 'req' }, ' · required to publish')),
            h('input', { id: altId, class: 'input', type: 'text', value: logo.alt || '', readOnly: ed.readOnly, 'aria-describedby': `${altId}-error`, placeholder: 'The name as written in the logo', on: { input: e => { logo.alt = e.target.value; ed.changed(); } } }),
            errorSlot(`${path}.alt`)),
          ed.readOnly ? null : h('div', { class: 'btn-row' },
            button(logo.source === 'asset' ? 'Replace image' : 'Use a library image instead', { iconName: 'image', id, onClick: chooseAsset, 'aria-describedby': `${id}-error` }),
            bundledButtons(logo),
            button('Remove logo', { variant: 'ghost', iconName: 'trash', onClick: () => { branding[key] = null; ed.changed(); render(); container.querySelector('button')?.focus(); } })))));
    }
    container.append(errorSlot(path));
  }
  render();
  return container;
}

function branding(ed) {
  const share = coverField({
    path: 'shareImage', idPath: 'branding.shareImage', model: ed.model.branding, ctx: ed.ctx, scope: ed.scope, pick: o => ed.pick(o), onChange: ed.changed, readOnly: ed.readOnly,
    label: 'Default social-sharing image', hint: 'Used when a page has no image of its own. JPEG, PNG or WebP from the local library; about 1200 × 630px suits most platforms (advisory).',
    allowCaption: false, altRequired: false, altPlaceholder: 'Optional description of the sharing image',
    texts: { pickTitle: 'Choose default sharing image', empty: 'No sharing image selected.', choose: 'Choose or upload sharing image', remove: 'Remove sharing image' }
  });
  return [
    h('p', { class: 'section-intro' }, 'At least one usable logo is needed to publish. Logos use the shared media library (JPEG, PNG or WebP; SVG uploads stay rejected). The bundled Vion logo is a trusted static file and can be chosen explicitly for light backgrounds.'),
    logoField(ed, 'logoLight', { label: 'Logo for light backgrounds', background: 'light', hint: 'For white or light page areas such as the header.' }),
    logoField(ed, 'logoDark', { label: 'Logo for dark backgrounds (optional)', background: 'dark', hint: 'For dark footers or image overlays. No bundled logo suits dark backgrounds, so upload one if needed.' }),
    share.el,
    ed.group(null, ed.checkbox('branding.shareImageUsesLogo', {
      label: 'Approve the light-background logo as the fallback sharing image',
      hint: 'Explicit fallback used only when no sharing image is chosen. It needs an uploaded JPEG/PNG/WebP logo; the bundled SVG logo cannot be a sharing image.'
    }))
  ];
}

function linkRepeater(ed, { key, itemLabel, emptyText, renderFields, removeTitle }) {
  return createRepeater({
    items: ed.model[key], readOnly: ed.readOnly, itemLabel, emptyText, onChange: () => ed.changed(),
    confirmRemove: (item, i) => (Object.values(item).some(v => typeof v === 'string' && v && v !== item.id) ? confirmDialog({ title: removeTitle(i), body: 'Its details will be removed from this draft.', confirmLabel: 'Remove', danger: true }) : true),
    renderItem: (item, i) => h('div', { class: 'form-grid' }, renderFields(i))
  });
}

function social(ed) {
  const repeater = linkRepeater(ed, {
    key: 'social', emptyText: 'No social profiles yet.', removeTitle: i => `Remove social profile ${i + 1}?`,
    itemLabel: (s, i) => `Social profile ${i + 1}${s.network ? `: ${s.network}` : ''}`,
    renderFields: i => [
      ed.text(`social.${i}.network`, { label: 'Network', required: 'publish', list: 'social-network-suggestions', hint: 'Pick a suggestion or type any other network name.' }),
      ed.text(`social.${i}.url`, { label: 'Profile address', required: 'publish', inputmode: 'url', placeholder: 'https://…' }),
      ed.checkbox(`social.${i}.visible`, { label: 'Show on site', hint: 'Only one visible profile per network.' })
    ]
  });
  const add = network => repeater.add(newSocialProfile(network));
  return [
    h('p', { class: 'section-intro' }, 'Official public profiles, shown in the footer in this order. Links must be https://.'),
    h('datalist', { id: 'social-network-suggestions' }, SOCIAL_NETWORK_SUGGESTIONS.map(n => h('option', { value: n }))),
    repeater.el,
    ed.readOnly ? null : h('div', { class: 'btn-row', id: fieldIdFor('social') }, SOCIAL_NETWORK_SUGGESTIONS.map(n => button(`Add ${n}`, { iconName: 'plus', onClick: () => add(n) })), button('Add other network', { iconName: 'plus', onClick: () => add('') })),
    errorSlot('social')
  ];
}

function reviews(ed) {
  const repeater = linkRepeater(ed, {
    key: 'reviews', emptyText: 'No review-platform links yet.', removeTitle: i => `Remove review link ${i + 1}?`,
    itemLabel: (r, i) => `Review link ${i + 1}${r.platform ? `: ${r.platform}` : ''}`,
    renderFields: i => [
      ed.text(`reviews.${i}.platform`, { label: 'Platform name', required: 'publish' }),
      ed.text(`reviews.${i}.url`, { label: 'Profile address', required: 'publish', inputmode: 'url', placeholder: 'https://…' }),
      ed.text(`reviews.${i}.buttonLabel`, { label: 'Button label', required: 'publish', placeholder: 'e.g. Read our reviews' }),
      ed.checkbox(`reviews.${i}.visible`, { label: 'Show on site' }),
      ed.text(`reviews.${i}.description`, { label: 'Description (optional)', multiline: true, rows: 2, hint: 'Plain text shown next to the button. Do not copy review scores or quotes you cannot verify.' })
    ]
  });
  return [
    h('p', { class: 'section-intro' }, 'Links to review-platform profiles. Display order is the list order (use Move up / Move down); hidden links are kept but not shown.'),
    repeater.el,
    ed.readOnly ? null : h('div', { class: 'btn-row' }, button('Add review link', { iconName: 'plus', id: fieldIdFor('reviews'), onClick: () => repeater.add(newReviewLink()) })),
    errorSlot('reviews')
  ];
}

function seo(ed) {
  const previewEl = h('div');
  const refresh = () => clear(previewEl).append(seoMetadataPreview(formToSettings(ed.model).record, { scope: ed.scope, assets: ed.ctx.assets }));
  refresh();
  const share = ed.model.branding.shareImage;
  return [
    h('p', { class: 'section-intro' }, 'Site-wide defaults for the local metadata preview. Length guidance is advisory. Production SEO and the live website are not changed.'),
    ed.group(null,
      ed.text('seo.siteName', { label: 'Site name (optional)', counter: SITE_NAME_ADVICE, onInput: refresh }),
      ed.text('seo.titleSuffix', { label: 'Title suffix (optional)', placeholder: 'e.g. | Site name', hint: 'Appended to page titles after a space.', onInput: refresh }),
      ed.text('seo.defaultDescription', { label: 'Default description (optional)', multiline: true, rows: 3, counter: SEO_DESCRIPTION_ADVICE, hint: 'Used when a page has no description of its own.', onInput: refresh })),
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Default sharing image'),
      h('p', null, share ? 'Chosen in Branding.' : ed.model.branding.shareImageUsesLogo ? 'No sharing image chosen; the approved logo fallback is used.' : 'Not chosen yet (required to publish).'),
      button('Change in Branding', { variant: 'secondary', iconName: 'image', onClick: () => ed.selectTab('branding') })),
    h('div', { class: 'form-group' }, h('h3', { class: 'group-title' }, 'Metadata preview (local)'), previewEl)
  ];
}

const settingsAdapter = {
  find: ctx => ctx.siteRecords.get(SETTINGS_ID) || null,
  newForm: () => settingsToForm(newSettings()),
  toForm: env => settingsToForm(env.record),
  fromForm: form => formToSettings(form),
  titleOf: () => 'Site settings',
  validateDraft: (record, ctx, { conversionIssues = [] } = {}) => [...conversionIssues, ...validateSettingsDraft(record, ctx)],
  validatePublish: (record, ctx, { conversionIssues = [] } = {}) => [...conversionIssues, ...validateSettingsPublish(record, ctx)],
  save: (ws, record, { expectedVersion }) => ws.site.saveSettings(record, { expectedVersion }),
  publish: (ws, env) => ws.site.publishSettings({ expectedVersion: env.record.version }),
  unpublish: (ws, env) => ws.site.unpublishSettings({ expectedVersion: env.record.version }),
  listHref: () => '#/dashboard',
  editorHref: () => '#/settings',
  previewHref: (def, env, rev) => `#/settings/preview${rev ? `?rev=${rev}` : ''}`,
  publishNotes: () => [h('p', null, 'This updates the local preview site only. The real Vion website, its footer, contact details and production SEO are not changed.')],
  unpublishBody: () => 'The published settings are removed from the local preview site, which then shows its “no published settings” state. The working draft is kept.',
  archivedNote: () => '',
  banners: () => [notice('info', 'Public site settings only. There are deliberately no fields for API keys, credentials, notification recipients, authentication settings, analytics IDs or integration secrets.')]
};

export const settingsModule = {
  kind: 'siteSettings', path: 'settings', label: 'Site settings', plural: 'Settings', icon: 'settings',
  navGroup: 'Settings', listLabel: 'Setting Options', addLabel: 'Setting Options', backLabel: 'Dashboard',
  adapter: settingsAdapter,
  sections: [
    { id: 'company', label: 'Company', render: company },
    { id: 'contact', label: 'Contact', render: contact },
    { id: 'branding', label: 'Branding', render: branding },
    { id: 'social', label: 'Social profiles', render: social },
    { id: 'reviews', label: 'Review links', render: reviews },
    { id: 'seo', label: 'Default SEO', render: seo },
    'preview'
  ]
};
