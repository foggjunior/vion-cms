// Team profiles (Settings › Team). Profiles are public content only: they are not user accounts, have no
// login and are not linked to authentication. Profile content is published per profile; display order and
// visibility belong to the separate team lineup (see shared/site.js).
import { button, h, linkButton } from '../components/dom.js';
import { confirmDialog } from '../components/dialog.js';
import { notice } from '../components/feedback.js';
import { fieldIdFor } from '../components/fields.js';
import { createRepeater } from '../components/repeater.js';
import { coverField } from '../components/media.js';
import { draftLineup, formToMember, memberToForm, newMember, newMemberLink, teamPageStatus } from './shared/site.js';
import { BIO_ADVICE, validateMemberDraft, validateMemberPublish } from './shared/site-validation.js';

// Draft placement of a profile: its position in the draft lineup, or last for a profile not yet in it.
function placementOf(env, ctx) {
  const entries = draftLineup(ctx)?.record.entries || [];
  const index = env ? entries.findIndex(e => e.memberId === env.id) : -1;
  return index === -1 ? { visible: true, position: entries.length + 1 } : { visible: entries[index].visible, position: index + 1 };
}

function profile(ed) {
  return [
    notice('info', 'Team profiles are public content, not staff accounts. Enter only details the person has agreed to publish; do not copy contact details from screenshots.'),
    ed.group(null,
      ed.text('name', { label: 'Name', required: true }),
      ed.text('position', { label: 'Position / title', required: 'publish' }),
      ed.text('bio', { label: 'Short biography', required: 'publish', multiline: true, rows: 6, counter: BIO_ADVICE, hint: 'Plain text, shown as text only (markup is not interpreted). Separate paragraphs with a blank line.' }))
  ];
}

function portrait(ed) {
  const name = ed.model.name?.trim();
  return [
    h('p', { class: 'section-intro' }, 'Upload a JPEG, PNG or WebP portrait (up to 10 MB) or reuse one from the local media library. Alt text describes this person in this context.'),
    coverField({
      path: 'portrait', model: ed.model, ctx: ed.ctx, scope: ed.scope, pick: o => ed.pick(o), onChange: ed.changed, readOnly: ed.readOnly,
      label: 'Portrait', allowCaption: false, altPlaceholder: name ? `Portrait of ${name}` : 'Portrait of the team member',
      texts: { pickTitle: 'Choose portrait', empty: 'No portrait selected.', choose: 'Choose or upload portrait', remove: 'Remove portrait' }
    }).el
  ];
}

function links(ed) {
  const repeater = createRepeater({
    items: ed.model.links, readOnly: ed.readOnly, emptyText: 'No public links.', onChange: () => ed.changed(),
    itemLabel: (link, i) => `Link ${i + 1}${link.label ? `: ${link.label}` : ''}`,
    confirmRemove: (link, i) => (link.label || link.url ? confirmDialog({ title: `Remove link ${i + 1}?`, body: 'The label and address will be removed from this draft.', confirmLabel: 'Remove link', danger: true }) : true),
    renderItem: (link, i) => h('div', { class: 'form-grid' },
      ed.text(`links.${i}.label`, { label: 'Label', required: 'publish', placeholder: 'e.g. LinkedIn profile' }),
      ed.text(`links.${i}.url`, { label: 'Address', required: 'publish', inputmode: 'url', placeholder: 'https://…', hint: 'https:// only.' }))
  });
  return [
    h('p', { class: 'section-intro' }, 'Optional public links, for example a professional profile. Only https:// addresses are accepted; javascript:, data: and other link types are rejected.'),
    repeater.el,
    ed.readOnly ? null : h('div', { class: 'btn-row' }, button('Add link', { iconName: 'plus', id: fieldIdFor('links'), onClick: () => repeater.add(newMemberLink()) })),
    h('p', { class: 'field-error', id: `${fieldIdFor('links')}-error`, hidden: true })
  ];
}

function placement(ed) {
  if (ed.readOnly) return [notice('warning', 'Archived profiles are not in the team order. Restore the profile to place it on the team page again.')];
  const entries = draftLineup(ed.ctx)?.record.entries || [];
  const count = ed.env && entries.some(e => e.memberId === ed.env.id) ? entries.length : entries.length + 1;
  const status = ed.env ? teamPageStatus(ed.env.id, ed.ctx) : null;
  return [
    notice('info', h('strong', null, 'How order and visibility are published. '),
      'These two settings are saved with “Save draft” into the draft team order. The local team page keeps the published order until someone chooses “Publish order & visibility” on the Team list. That step publishes order and visibility only — never profile text or portraits — and publishing this profile never publishes the order.'),
    ed.group(null,
      ed.checkbox('placement.visible', { label: 'Visible on the team page', hint: 'Unticked keeps the profile (and any published version) but hides it from the team grid once the order is published.' }),
      ed.select('placement.position', { label: 'Display order', hint: 'Position in the draft team order (1 = first). You can also use Move up / Move down on the Team list.', options: Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: `${i + 1} of ${count}` })) })),
    status ? h('p', { class: 'muted' }, h('strong', null, 'Published team page: '), status.reason) : h('p', { class: 'muted' }, 'New profiles are added to the draft team order when first saved.'),
    ed.env ? h('div', { class: 'btn-row' }, reviewVisibilityLink()) : null
  ];
}

// Opens the existing Team list with focus on its order & visibility panel. It only navigates: nothing is
// published by following it.
const reviewVisibilityLink = () => linkButton('Review team visibility', '#/team?focus=lineup', { variant: 'secondary', iconName: 'eye', 'data-action': 'review-visibility' });

const teamAdapter = {
  find: (ctx, id) => { const env = id ? ctx.siteRecords.get(id) : null; return env?.kind === 'teamMember' ? env : null; },
  newForm: ctx => memberToForm(newMember(), placementOf(null, ctx)),
  toForm: (env, ctx) => memberToForm(env.record, placementOf(env, ctx)),
  fromForm: form => formToMember(form),
  session: (env, ctx) => ({ lineupVersion: draftLineup(ctx)?.record.version ?? null, placement: placementOf(env, ctx) }),
  titleOf: record => record.name?.trim(),
  validateDraft: (record, ctx, { conversionIssues = [] } = {}) => [...conversionIssues, ...validateMemberDraft(record, ctx)],
  validatePublish: (record, ctx, { conversionIssues = [] } = {}) => [...conversionIssues, ...validateMemberPublish(record, ctx)],
  // Placement is sent only when it changed (always for a new profile), guarded by the lineup version loaded.
  save(ws, record, { expectedVersion, extra, session, isNew }) {
    const next = extra?.placement;
    const changed = isNew || (next && (next.visible !== session?.placement.visible || (next.position != null && next.position !== session?.placement.position)));
    return ws.site.saveMember(record, { expectedVersion, placement: changed ? next : null, expectedLineupVersion: session?.lineupVersion ?? null });
  },
  publish: (ws, env) => ws.site.publishMember(env.id, { expectedVersion: env.record.version }),
  unpublish: (ws, env) => ws.site.unpublishMember(env.id, { expectedVersion: env.record.version }),
  archive: (ws, env) => ws.site.archiveMember(env.id, { expectedVersion: env.record.version }),
  restore: (ws, env) => ws.site.restoreMember(env.id, { expectedVersion: env.record.version }),
  listHref: () => '#/team',
  editorHref: (def, id) => `#/team/${id}`,
  previewHref: (def, env, rev) => `#/team/${env.id}/preview${rev ? `?rev=${rev}` : ''}`,
  publishNotes: () => [h('p', null, 'This publishes the profile content only. Its order and visibility on the team page are published separately with “Publish order & visibility” on the Team list.')],
  publishedToast: (env, ctx) => (teamPageStatus(env.id, ctx).onPage ? 'Profile published to the local preview.' : 'Profile published locally. It appears on the local team page once its order and visibility are published from the Team list.'),
  // Follow-up after publishing a profile: a direct route to the order/visibility screen. Order and
  // visibility stay a separate, explicit publication; nothing else is published here.
  afterPublish: (env, ctx) => [notice('success', h('strong', null, 'Profile content published. '), `${teamPageStatus(env.id, ctx).reason} Order and visibility are published separately on the Team list. `, reviewVisibilityLink())],
  unpublishBody: () => 'The published profile is removed from the local preview and the team page. The profile, its draft and its place in the team order are kept; you can publish it again later.',
  archivedNote: env => `It keeps its content but is read-only, has no published version and is not in the team order. ${env.workflow.priorStatus ? `It was ${env.workflow.priorStatus} before archiving. ` : ''}Restore it to draft to edit; it returns to the end of the draft team order and must be republished.`,
  archiveBody: env => `${env.record.status === 'published' ? 'Its published version is removed from the local preview. ' : ''}It is taken out of the draft team order and becomes read-only. Its content and portrait reference are kept, and you can restore it to draft later.`,
  banners: (env, ctx) => (env && env.record.status !== 'archived' ? [notice('info', h('strong', null, 'Team page: '), teamPageStatus(env.id, ctx).reason)] : [])
};

export const teamModule = {
  kind: 'teamMember', path: 'team', label: 'Team profile', plural: 'Team', icon: 'users',
  navGroup: 'Settings', listLabel: 'Team', addLabel: 'New profile', addNavLabel: 'Team', backLabel: 'All team profiles',
  adapter: teamAdapter,
  sections: [
    { id: 'profile', label: 'Profile', render: profile },
    { id: 'portrait', label: 'Portrait', render: portrait },
    { id: 'links', label: 'Links', render: links },
    { id: 'placement', label: 'Team page', render: placement },
    'preview'
  ]
};
