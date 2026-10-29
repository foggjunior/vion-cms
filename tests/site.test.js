import { assert, assertEqual, assertIssue, assertNoErrors, assertRejects, hasIssue, test } from './harness.js';
import { completeDestination, completeMember, completeSettings, envelope, imageFile, schema, siteContext, siteSchema, siteValidator, storedAsset, withWorkspace } from './fixtures.js';
import { LINEUP_ID, SETTINGS_ID, moveEntry, newLineup, newMember, newSettings, placeEntry, publishedTeam, siteAssetRefs, teamPageStatus } from '../src/modules/shared/site.js';
import { emailMessage, httpsUrlMessage, mailtoHref, mapsUrlMessage, telHref, timeZoneMessage, validateMemberDraft, validateMemberPublish, validateSettingsDraft, validateSettingsPublish } from '../src/modules/shared/site-validation.js';
import { footerPreview, memberPage } from '../src/modules/site-preview.js';
import { MediaUrlScope } from '../src/components/media.js';
import { hasUnpublishedChanges, newRecord } from '../src/modules/shared/records.js';
import { DB_VERSION } from '../src/storage/idb.js';
import { deleteWorkspace, openWorkspace } from '../src/storage/workspace.js';

const settingsWith = (base, changes) => ({ ...base, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, Array.isArray(v) ? v : { ...base[k], ...v }])) });

// ---- schema and pure rules ----
test('site schema: new settings, profiles and lineup are valid; unknown and secret-like fields are rejected', () => {
  assertEqual(siteValidator.validateRecord(newSettings()), []);
  assertEqual(siteValidator.validateRecord(newMember({ name: 'A' })), []);
  assertEqual(siteValidator.validateRecord(newLineup()), []);
  const s = newSettings();
  const errors = siteValidator.validateRecord({ ...s, id: 'second-settings', apiKey: 'sk-test', contact: { ...s.contact, notificationRecipients: 'x@example.com' } });
  for (const path of ['id', 'apiKey', 'contact.notificationRecipients']) assert(errors.some(e => e.path === path), `expected schema error at ${path}: ${JSON.stringify(errors)}`);
  const logo = siteValidator.validateRecord({ ...s, branding: { ...s.branding, logoLight: { source: 'bundled', key: 'uploaded.svg', alt: '' } } });
  assert(logo.length > 0, 'unknown bundled logo key accepted');
  assertEqual(siteValidator.kinds, ['siteSettings', 'teamMember', 'teamLineup']);
});

test('site rules: lineup placement helpers keep one entry per profile and clamp positions', () => {
  const e = [{ memberId: 'a', visible: true }, { memberId: 'b', visible: false }, { memberId: 'c', visible: true }];
  assertEqual(placeEntry(e, 'd', {}).map(x => x.memberId), ['a', 'b', 'c', 'd'], 'new profile appended');
  assertEqual(placeEntry(e, 'c', { position: 1 }).map(x => x.memberId), ['c', 'a', 'b']);
  assertEqual(placeEntry(e, 'a', { position: 99, visible: false }), [{ memberId: 'b', visible: false }, { memberId: 'c', visible: true }, { memberId: 'a', visible: false }]);
  assertEqual(placeEntry(e, 'b', {})[1], { memberId: 'b', visible: false }, 'visibility kept when not given');
  assertEqual(moveEntry(e, 'b', -1).map(x => x.memberId), ['b', 'a', 'c']);
  assertEqual(moveEntry(e, 'a', -1), null, 'cannot move above the first position');
});

test('site rules: phone, email, timezone and link checks; tel/mailto hrefs are built only from valid values', () => {
  assertEqual(emailMessage('info@example.com'), null);
  for (const bad of ['info@example', 'Info <info@example.com>', 'a b@example.com', 'x@example.com?subject=hi', '.a@example.com']) assert(emailMessage(bad), `accepted ${bad}`);
  assertEqual(timeZoneMessage('Africa/Dar_es_Salaam'), null);
  assertEqual(timeZoneMessage('UTC'), null);
  for (const bad of ['EAT', '+03:00', 'Mars/Olympus_Mons', 'Africa/Dar es Salaam']) assert(timeZoneMessage(bad), `accepted ${bad}`);
  assert(/exact spelling/.test(timeZoneMessage('africa/dar_es_salaam') || ''), 'wrong capitalisation not flagged');
  assertEqual(httpsUrlMessage('https://www.example.com/profile'), null);
  assert(/http:\/\/ links are not accepted/.test(httpsUrlMessage('http://www.example.com')));
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://example.com', 'https://user:pw@example.com', 'www.example.com']) assert(httpsUrlMessage(bad), `accepted ${bad}`);
  assertEqual(mapsUrlMessage('https://maps.app.goo.gl/abc123'), null);
  assertEqual(mapsUrlMessage('https://www.google.com/maps/place/Arusha'), null);
  assert(mapsUrlMessage('https://www.google.evil.com/maps/x'), 'look-alike host accepted');
  assert(mapsUrlMessage('https://www.example.com/maps'), 'non-Google host accepted');
  assertEqual(telHref('+255 (0) 700-000-000'), 'tel:+2550700000000');
  assertEqual(telHref('javascript:alert(1)'), null);
  assertEqual(mailtoHref('info@example.com'), 'mailto:info@example.com');
  assertEqual(mailtoHref('x@example.com?bcc=y@example.com'), null);
});

test('settings validation: empty drafts save; supplied values must be valid; duplicate visible networks rejected', () => {
  const ctx = siteContext();
  assertNoErrors(validateSettingsDraft(newSettings(), ctx), 'an empty settings draft is valid');
  const s = newSettings();
  const bad = settingsWith(s, {
    company: { timezone: 'EAT' },
    contact: { primaryPhone: 'call us', email: 'not-an-email', mapsUrl: 'http://maps.google.com/x' },
    social: [
      { id: 's1', network: 'Instagram', url: 'javascript:alert(1)', visible: true },
      { id: 's2', network: 'instagram', url: 'https://www.instagram.com/example', visible: true },
      { id: 's3', network: 'Instagram', url: 'https://www.instagram.com/old', visible: false },
      { id: 's4', network: 'Mastodon', url: 'data:text/html,hi', visible: true }
    ],
    reviews: [{ id: 'r1', platform: 'Example Reviews', url: 'http://reviews.example.com', description: '', buttonLabel: '', visible: true }]
  });
  const issues = validateSettingsDraft(bad, ctx);
  for (const path of ['company.timezone', 'contact.primaryPhone', 'contact.email', 'contact.mapsUrl', 'social.0.url', 'social.3.url', 'reviews.0.url']) assertIssue(issues, path);
  assertIssue(issues, 'social.1.network', /duplicate visible networks/);
  assert(!hasIssue(issues, 'social.2.network'), 'a hidden duplicate is allowed');
  assert(!hasIssue(issues, 'reviews.0.buttonLabel'), 'incomplete review links are allowed in drafts');
  const otherNetwork = validateSettingsDraft(settingsWith(s, { social: [{ id: 'x', network: 'Threads', url: 'https://www.threads.net/@example', visible: true }] }), ctx);
  assertNoErrors(otherNetwork, 'other named networks need no code change');
});

test('settings validation: publication minimum, optional fields stay optional, bundled logo and sharing fallback rules', () => {
  const share = { id: crypto.randomUUID(), fileName: 'share.jpg', type: 'image/jpeg', size: 10, width: 1200, height: 630, alt: '', credit: '', caption: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
  const logoAsset = { ...share, id: crypto.randomUUID(), fileName: 'logo.png' };
  const ctx = siteContext({ assets: [share, logoAsset] });
  const empty = validateSettingsPublish(newSettings(), ctx);
  for (const path of ['company.name', 'company.officeAddress', 'contact.primaryPhone', 'contact.email', 'branding.logoLight', 'branding.shareImage']) assertIssue(empty, path);
  for (const path of ['company.tagline', 'company.footerDescription', 'contact.emergencyPhone', 'contact.mapsUrl', 'seo.siteName', 'seo.titleSuffix', 'branding.logoDark']) assert(!hasIssue(empty, path), `optional field required: ${path}`);
  const complete = completeSettings(share);
  assertNoErrors(validateSettingsPublish(complete, ctx), 'bundled light logo + sharing image is publishable');
  assertIssue(validateSettingsPublish({ ...complete, company: { ...complete.company, timezone: '' } }, ctx), 'company.timezone');
  const darkBundled = { ...complete, branding: { ...complete.branding, logoDark: { source: 'bundled', key: 'vion-logo-dark-artwork', alt: 'Logo' } } };
  assertIssue(validateSettingsDraft(darkBundled, ctx), 'branding.logoDark', /light backgrounds only/);
  const noAlt = { ...complete, branding: { ...complete.branding, logoLight: { ...complete.branding.logoLight, alt: '' } } };
  assertIssue(validateSettingsPublish(noAlt, ctx), 'branding.logoLight.alt');
  const bundledFallback = { ...complete, branding: { ...complete.branding, shareImage: null, shareImageUsesLogo: true } };
  assertIssue(validateSettingsPublish(bundledFallback, ctx), 'branding.shareImageUsesLogo', /SVG/);
  const rasterFallback = { ...bundledFallback, branding: { ...bundledFallback.branding, logoLight: { source: 'asset', assetId: logoAsset.id, alt: 'Example Safari Co' } } };
  assertNoErrors(validateSettingsPublish(rasterFallback, ctx), 'explicit fallback to an uploaded logo');
  const missingFile = validateSettingsPublish(complete, siteContext({ assets: [share], blobs: false }));
  assertIssue(missingFile, 'branding.shareImage', /not stored in this browser/);
  const incompleteLink = { ...complete, reviews: [{ id: 'r', platform: 'Example Reviews', url: 'https://reviews.example.com/x', description: '', buttonLabel: '', visible: true }] };
  assertIssue(validateSettingsPublish(incompleteLink, ctx), 'reviews.0.buttonLabel');
});

test('team validation: name-only drafts; publication needs position, biography, portrait and alt; links https only', () => {
  const img = { id: crypto.randomUUID(), fileName: 'p.jpg', type: 'image/jpeg', size: 10, width: 800, height: 1000, alt: '', credit: '', caption: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
  const ctx = siteContext({ assets: [img] });
  assertNoErrors(validateMemberDraft(newMember({ name: 'Draft Person' }), ctx));
  assertIssue(validateMemberDraft(newMember({ name: '   ' }), ctx), 'name');
  const pub = validateMemberPublish(newMember({ name: 'X' }), ctx);
  for (const path of ['position', 'bio', 'portrait']) assertIssue(pub, path);
  const member = completeMember(img);
  assertNoErrors(validateMemberPublish(member, ctx));
  assertIssue(validateMemberPublish({ ...member, portrait: { ...member.portrait, alt: '' } }, ctx), 'portrait.alt');
  const links = validateMemberDraft({ ...member, links: [{ id: 'l1', label: 'Profile', url: 'javascript:alert(1)' }, { id: 'l2', label: 'Old', url: 'http://www.example.com' }, { id: 'l3', label: '', url: 'https://www.example.com/p' }] }, ctx);
  assertIssue(links, 'links.0.url', /rejected for safety/);
  assertIssue(links, 'links.1.url', /https/);
  assertIssue(validateMemberPublish({ ...member, links: [{ id: 'l3', label: '', url: 'https://www.example.com/p' }] }, ctx), 'links.0.label');
  assertIssue(validateMemberDraft({ ...member, portrait: { assetId: 'missing', alt: 'x' } }, ctx), 'portrait', /missing from the local media library/);
});

test('rendering: biography, names and labels are text; unsafe stored links never become hrefs', () => {
  const scope = new MediaUrlScope({ getBlob: async () => null });
  const member = { ...newMember({ name: '<img src=x onerror="window.__siteXss=1">' }), position: '<b>Lead</b>', bio: '<script>window.__siteXss=2</script>\n\nSecond paragraph',
    links: [{ id: 'a', label: 'Bad', url: 'javascript:alert(1)' }, { id: 'b', label: 'Data', url: 'data:text/html,x' }, { id: 'c', label: 'Good <i>link</i>', url: 'https://www.example.com/p' }] };
  const page = memberPage(member, { scope, assets: new Map() });
  assert(page.textContent.includes('<img src=x onerror="window.__siteXss=1">') && page.textContent.includes('<script>window.__siteXss=2</script>'), 'markup not shown literally');
  assert(!page.querySelector('img[src="x"], script, b, i'), 'user markup became elements');
  assertEqual([...page.querySelectorAll('a')].map(a => a.getAttribute('href')), ['https://www.example.com/p']);
  assertEqual(page.querySelectorAll('.prose p').length, 2, 'paragraphs from blank lines');
  const s = newSettings();
  const footer = footerPreview(settingsWith(s, {
    company: { name: 'Example <Co>', footerDescription: '<script>1</script>' },
    contact: { primaryPhone: '+255 700 000 000', email: 'info@example.com' },
    social: [{ id: 's', network: 'Facebook', url: 'javascript:alert(1)', visible: true }, { id: 't', network: 'TikTok', url: 'https://www.tiktok.com/@example', visible: false }],
    reviews: [{ id: 'r', platform: 'Example Reviews', url: 'https://reviews.example.com/vion', description: 'Read <b>reviews</b>', buttonLabel: 'Read reviews', visible: true }]
  }), { scope, assets: new Map() });
  const hrefs = [...footer.querySelectorAll('a')].map(a => a.getAttribute('href'));
  assertEqual(hrefs, ['tel:+255700000000', 'mailto:info@example.com', 'https://reviews.example.com/vion']);
  assert(footer.textContent.includes('link not shown'), 'unsafe social link not explained');
  assert(!footer.textContent.includes('TikTok'), 'hidden social profile shown');
  assert(!footer.querySelector('script, b') && footer.textContent.includes('<script>1</script>'), 'footer markup interpreted');
  assertEqual(window.__siteXss, undefined);
});

// ---- repository ----
test('settings: one stable singleton; duplicate creation and stale writes are rejected; survives reconnect', () => withWorkspace(async (ws, reopen) => {
  const saved = await ws.site.saveSettings(newSettings());
  assertEqual([saved.id, saved.record.version, saved.record.status], [SETTINGS_ID, 1, 'draft']);
  await assertRejects(ws.site.saveSettings(newSettings()), { code: 'conflict', match: /only ever one settings record/ });
  await assertRejects(ws.site.saveSettings({ ...newSettings(), id: crypto.randomUUID() }), { code: 'validation' });
  const named = settingsWith(saved.record, { company: { name: 'Example Safari Co' } });
  const updated = await ws.site.saveSettings(named, { expectedVersion: 1 });
  assertEqual(updated.record.version, 2);
  await assertRejects(ws.site.saveSettings(settingsWith(saved.record, { company: { name: 'Stale tab' } }), { expectedVersion: 1 }), { code: 'stale' });
  await assertRejects(ws.site.saveSettings(settingsWith(updated.record, { contact: { email: 'nope' } }), { expectedVersion: 2 }), { code: 'validation' });
  const fresh = await reopen();
  const ctx = await fresh.loadContext();
  assertEqual([...ctx.siteRecords.values()].filter(env => env.kind === 'siteSettings').length, 1);
  assertEqual([(await fresh.site.getSettings()).record.company.name, (await fresh.site.getSettings()).record.version], ['Example Safari Co', 2]);
}));

test('settings: publishing snapshots the saved draft; later drafts never change it until republished', () => withWorkspace(async ws => {
  const share = await storedAsset(ws);
  const draft = await ws.site.saveSettings(newSettings());
  const err = await assertRejects(ws.site.publishSettings({ expectedVersion: 1 }), { code: 'validation' });
  assert(err.issues.some(i => i.path === 'contact.email'), 'publish minimum not enforced');
  const ready = await ws.site.saveSettings({ ...completeSettings(share), createdAt: draft.record.createdAt }, { expectedVersion: 1 });
  let pub = await ws.site.publishSettings({ expectedVersion: ready.record.version });
  assertEqual([pub.record.status, pub.workflow.publishedRevision], ['published', 1]);
  const edited = await ws.site.saveSettings(settingsWith(pub.record, { company: { name: 'DRAFT ONLY name' } }), { expectedVersion: pub.record.version });
  assertEqual((await ws.site.getPublishedSettings()).snapshot.company.name, 'Example Safari Co');
  assert(hasUnpublishedChanges(edited), 'unpublished changes not detectable');
  pub = await ws.site.publishSettings({ expectedVersion: edited.record.version });
  const snap = await ws.site.getPublishedSettings();
  assertEqual([snap.snapshot.company.name, snap.revision], ['DRAFT ONLY name', 2]);
  await assertRejects(ws.site.publishSettings({ expectedVersion: 1 }), { code: 'stale' });
  const off = await ws.site.unpublishSettings({ expectedVersion: pub.record.version });
  assertEqual([off.record.status, await ws.site.getPublishedSettings()], ['draft', null]);
}));

test('site writes: simulated storage failures abort the transaction and never report success', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const settings = await ws.site.saveSettings(newSettings());
  ws.faults.failNext('saveSettings', 'QuotaExceededError');
  await assertRejects(ws.site.saveSettings(settingsWith(settings.record, { company: { name: 'Lost' } }), { expectedVersion: 1 }), { code: 'quota' });
  assertEqual([(await ws.site.getSettings()).record.version, (await ws.site.getSettings()).record.company.name], [1, '']);
  ws.faults.failNext('saveMember', 'QuotaExceededError');
  const draft = completeMember(img);
  await assertRejects(ws.site.saveMember(draft), { code: 'quota' });
  assertEqual([await ws.site.getMember(draft.id), await ws.site.getLineup()], [null, null], 'neither profile nor lineup written');
  const a = await ws.site.saveMember(completeMember(img, 'Asha Example'));
  const b = await ws.site.saveMember(completeMember(img, 'Baraka Example'));
  const lineup = await ws.site.getLineup();
  ws.faults.failNext('moveMember', 'UnknownError');
  await assertRejects(ws.site.moveMember(b.id, -1, { expectedVersion: lineup.record.version }), { code: 'unknown' });
  assertEqual((await ws.site.getLineup()).record.entries.map(e => e.memberId), [a.id, b.id]);
  ws.faults.failNext('publishLineup', 'AbortError');
  await assertRejects(ws.site.publishLineup({ expectedVersion: lineup.record.version }), { code: 'aborted' });
  assertEqual(await ws.site.getPublishedLineup(), null);
}));

test('team: reordering and visibility change only the draft lineup; publishing the lineup never publishes profile edits', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const a0 = await ws.site.saveMember(completeMember(img, 'Asha Example'));
  const b0 = await ws.site.saveMember(completeMember(img, 'Baraka Example'));
  const c0 = await ws.site.saveMember(newMember({ name: 'Chausiku Draft' }));
  assertEqual((await ws.site.getLineup()).record.entries.map(e => e.memberId), [a0.id, b0.id, c0.id], 'new profiles join the draft lineup in creation order');
  const a = await ws.site.publishMember(a0.id, { expectedVersion: 1 });
  await ws.site.publishMember(b0.id, { expectedVersion: 1 });
  let ctx = await ws.loadContext();
  assertEqual(publishedTeam(ctx), [], 'nothing on the team page before the lineup is published');
  assert(/not in the published team order/.test(teamPageStatus(a.id, ctx).reason));
  const aEdit = await ws.site.saveMember({ ...a.record, bio: 'DRAFT ONLY biography' }, { expectedVersion: a.record.version });
  let lineup = await ws.site.publishLineup({ expectedVersion: (await ws.site.getLineup()).record.version });
  ctx = await ws.loadContext();
  assertEqual(publishedTeam(ctx).map(p => p.id), [a0.id, b0.id], 'published, visible profiles in order; the unpublished draft is not shown');
  assertEqual((await ws.site.getPublishedMember(a0.id)).snapshot.bio, 'Plans safaris across the north.', 'lineup publish did not publish the draft bio');
  lineup = await ws.site.moveMember(b0.id, -1, { expectedVersion: lineup.record.version });
  await assertRejects(ws.site.moveMember(a0.id, 1, { expectedVersion: lineup.record.version - 1 }), { code: 'stale' });
  await assertRejects(ws.site.moveMember(b0.id, -1, { expectedVersion: lineup.record.version }), { code: 'invalid-state' });
  lineup = await ws.site.setMemberVisibility(a0.id, false, { expectedVersion: lineup.record.version });
  ctx = await ws.loadContext();
  assertEqual(publishedTeam(ctx).map(p => p.id), [a0.id, b0.id], 'draft order/visibility do not change the published team page');
  const aNow = await ws.site.getMember(a0.id);
  assertEqual([aNow.record.version, aNow.record.bio], [aEdit.record.version, 'DRAFT ONLY biography'], 'lineup writes never touch profile records');
  await ws.site.publishLineup({ expectedVersion: lineup.record.version });
  ctx = await ws.loadContext();
  assertEqual(publishedTeam(ctx).map(p => p.id), [b0.id], 'hidden profile removed after publishing the lineup');
  assertEqual((await ws.site.getPublishedMember(a0.id)).snapshot.bio, 'Plans safaris across the north.');
  assert(hasUnpublishedChanges(await ws.site.getMember(a0.id)), 'profile still has its own unpublished changes');
  assertEqual(teamPageStatus(a0.id, ctx).reason, 'Not shown: hidden in the published team order.');
}));

test('team: editor placement saves with the profile in one transaction and is stale-checked against the lineup', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const a = await ws.site.saveMember(completeMember(img, 'Asha Example'));
  const b = await ws.site.saveMember(completeMember(img, 'Baraka Example'), { placement: { position: 1, visible: false } });
  let lineup = await ws.site.getLineup();
  assertEqual(lineup.record.entries, [{ memberId: b.id, visible: false }, { memberId: a.id, visible: true }]);
  const v = lineup.record.version;
  const contentOnly = await ws.site.saveMember({ ...a.record, position: 'Lead planner' }, { expectedVersion: 1, expectedLineupVersion: v - 1 });
  assertEqual([contentOnly.record.version, (await ws.site.getLineup()).record.version], [2, v], 'content-only save leaves the lineup alone');
  await assertRejects(ws.site.saveMember({ ...contentOnly.record, position: 'X' }, { expectedVersion: 2, placement: { position: 1, visible: true }, expectedLineupVersion: v - 1 }), { code: 'stale', match: /team order/ });
  assertEqual((await ws.site.getMember(a.id)).record.version, 2, 'rejected placement change did not save the profile either');
  await ws.site.saveMember({ ...contentOnly.record }, { expectedVersion: 2, placement: { position: 1, visible: true }, expectedLineupVersion: v });
  lineup = await ws.site.getLineup();
  assertEqual(lineup.record.entries.map(e => e.memberId), [a.id, b.id]);
}));

test('team: unpublish and archive remove profiles from the team page; restore needs republishing', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  const ids = [];
  for (const name of ['Asha Example', 'Baraka Example', 'Chausiku Example']) {
    const saved = await ws.site.saveMember(completeMember(img, name));
    await ws.site.publishMember(saved.id, { expectedVersion: 1 });
    ids.push(saved.id);
  }
  let lineup = await ws.site.setMemberVisibility(ids[1], false, { expectedVersion: (await ws.site.getLineup()).record.version });
  await ws.site.publishLineup({ expectedVersion: lineup.record.version });
  let ctx = await ws.loadContext();
  assertEqual(publishedTeam(ctx).map(p => p.id), [ids[0], ids[2]]);
  await ws.site.unpublishMember(ids[2], { expectedVersion: (await ws.site.getMember(ids[2])).record.version });
  ctx = await ws.loadContext();
  assertEqual(publishedTeam(ctx).map(p => p.id), [ids[0]], 'unpublished profile leaves the team page immediately');
  assert((await ws.site.getLineup()).record.entries.some(e => e.memberId === ids[2]), 'unpublish keeps the profile in the order');
  const archived = await ws.site.archiveMember(ids[1], { expectedVersion: (await ws.site.getMember(ids[1])).record.version });
  assertEqual([archived.record.status, archived.workflow.priorStatus, archived.workflow.priorVisible], ['archived', 'published', false]);
  assertEqual(await ws.site.getPublishedMember(ids[1]), null);
  assert(!(await ws.site.getLineup()).record.entries.some(e => e.memberId === ids[1]), 'archived profile left the draft order');
  await assertRejects(ws.site.saveMember({ ...archived.record, name: 'Edited' }, { expectedVersion: archived.record.version }), { code: 'invalid-state' });
  await assertRejects(ws.site.publishMember(ids[1], { expectedVersion: archived.record.version }), { code: 'invalid-state' });
  const restored = await ws.site.restoreMember(ids[1], { expectedVersion: archived.record.version });
  assertEqual([restored.record.status, restored.record.name, await ws.site.getPublishedMember(ids[1])], ['draft', 'Baraka Example', null]);
  const entries = (await ws.site.getLineup()).record.entries;
  assertEqual(entries.at(-1), { memberId: ids[1], visible: false }, 'restored at the end with its earlier visibility');
}));

test('media: portraits, logos and sharing images in drafts or published snapshots cannot be deleted', () => withWorkspace(async ws => {
  const portrait = await storedAsset(ws);
  const replacement = await storedAsset(ws);
  const logo = await storedAsset(ws);
  const share = await storedAsset(ws);
  const unused = await storedAsset(ws);
  const member = await ws.site.saveMember(completeMember(portrait));
  const published = await ws.site.publishMember(member.id, { expectedVersion: 1 });
  await ws.site.saveMember({ ...published.record, portrait: { assetId: replacement.id, alt: 'Portrait of Asha Example' } }, { expectedVersion: published.record.version });
  const err = await assertRejects(ws.media.remove(portrait.id), { code: 'dependency' });
  assert(err.usage.some(u => u.kind === 'teamMember' && u.where === 'published snapshot' && u.role === 'portrait'), JSON.stringify(err.usage));
  await assertRejects(ws.media.remove(replacement.id), { code: 'dependency', match: /portrait/ });
  const s = completeSettings(share);
  await ws.site.saveSettings({ ...s, branding: { ...s.branding, logoDark: { source: 'asset', assetId: logo.id, alt: 'Example Safari Co' } } });
  const usage = await ws.media.usage(logo.id);
  assertEqual(usage.map(u => [u.kind, u.role, u.href]), [['siteSettings', 'dark-background logo', '#/settings']]);
  await assertRejects(ws.media.remove(logo.id), { code: 'dependency', match: /Site settings/ });
  await assertRejects(ws.media.remove(share.id), { code: 'dependency', match: /default sharing image/ });
  await ws.media.remove(unused.id);
  assertEqual((await ws.media.list()).length, 4);
}));

test('storage: upgrading a populated version-1 database keeps records and media and adds the site stores', async () => {
  const dbName = `vion-test-${crypto.randomUUID()}`;
  const file = await imageFile();
  const img = { id: crypto.randomUUID(), fileName: 'old.png', type: 'image/png', size: file.size, width: 1600, height: 900, alt: 'Old', credit: '', caption: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
  const dest = { ...completeDestination(img), status: 'published', version: 2 };
  const env = envelope(dest, { lastPublishedRoute: '/destinations/serengeti-national-park', routeHistory: [{ route: '/destinations/serengeti-national-park', firstPublishedAt: dest.updatedAt }], publishedRevision: 1, lastPublishedAt: dest.updatedAt, publishedSourceVersion: 2 });
  // Frozen copy of the version-1 layout (what browsers that ran the previous release hold).
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('records', { keyPath: 'id' }).createIndex('kind', 'kind');
      db.createObjectStore('published', { keyPath: 'id' }).createIndex('kind', 'kind');
      db.createObjectStore('redirects', { keyPath: 'id' }).createIndex('from', 'from', { unique: true });
      db.createObjectStore('assets', { keyPath: 'id' });
      db.createObjectStore('assetBlobs', { keyPath: 'id' });
      db.createObjectStore('taxonomies', { keyPath: 'id' }).createIndex('namespace', 'namespace');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['records', 'published', 'assets', 'assetBlobs'], 'readwrite');
      tx.objectStore('records').put(env);
      tx.objectStore('published').put({ id: dest.id, kind: 'destination', revision: 1, publishedAt: dest.updatedAt, sourceVersion: 2, route: '/destinations/serengeti-national-park', snapshot: dest });
      tx.objectStore('assets').put(img);
      tx.objectStore('assetBlobs').put({ id: img.id, blob: file });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
  let ws;
  try {
    ws = await openWorkspace({ dbName, schema, siteSchema });
    assertEqual([ws.db.version, DB_VERSION], [2, 2]);
    assert(['siteRecords', 'sitePublished', 'records', 'published', 'redirects', 'assets', 'assetBlobs', 'taxonomies', 'meta'].every(n => ws.db.objectStoreNames.contains(n)), 'stores missing after upgrade');
    assertEqual((await ws.content.get(dest.id)).record.overview, 'Vast plains.');
    assertEqual((await ws.content.getPublished(dest.id)).route, '/destinations/serengeti-national-park');
    assertEqual((await ws.media.getBlob(img.id)).size, file.size);
    await assertRejects(ws.media.remove(img.id), { code: 'dependency' });
    const saved = await ws.site.saveSettings(newSettings());
    assertEqual(saved.record.version, 1);
    const member = await ws.site.saveMember({ ...completeMember(img) });
    assertEqual((await ws.site.getLineup()).record.entries.map(e => e.memberId), [member.id]);
    const backup = JSON.parse(JSON.stringify(await ws.backup.exportData()));
    assertEqual([backup.records.length, backup.siteRecords.length], [1, 3]);
  } finally {
    ws?.close();
    await deleteWorkspace(dbName);
  }
});

// ---- backup ----
async function populateSite(ws) {
  const portrait = await storedAsset(ws);
  const share = await storedAsset(ws);
  const logo = await storedAsset(ws);
  const s = completeSettings(share);
  const settings = await ws.site.saveSettings({ ...s, branding: { ...s.branding, logoDark: { source: 'asset', assetId: logo.id, alt: 'Example Safari Co' } }, social: [{ id: 's1', network: 'Instagram', url: 'https://www.instagram.com/example', visible: true }] });
  await ws.site.publishSettings({ expectedVersion: settings.record.version });
  const a = await ws.site.saveMember(completeMember(portrait, 'Asha Example'));
  const b = await ws.site.saveMember(completeMember(portrait, 'Baraka Example'));
  const pa = await ws.site.publishMember(a.id, { expectedVersion: 1 });
  await ws.site.publishMember(b.id, { expectedVersion: 1 });
  await ws.site.saveMember({ ...pa.record, bio: 'Unpublished draft bio' }, { expectedVersion: pa.record.version });
  let lineup = await ws.site.moveMember(b.id, -1, { expectedVersion: (await ws.site.getLineup()).record.version });
  lineup = await ws.site.publishLineup({ expectedVersion: lineup.record.version });
  await ws.site.setMemberVisibility(a.id, false, { expectedVersion: lineup.record.version });
  return { portrait, share, logo, a, b };
}

// Every media reference held by content and site records points at an asset whose file is stored.
async function orphanedReferences(ws) {
  const ctx = await ws.loadContext();
  const refs = [...ctx.siteRecords.values()].map(e => e.record).concat([...ctx.sitePublished.values()].map(p => p.snapshot)).flatMap(siteAssetRefs);
  return refs.filter(r => !ctx.assets.get(r.assetId)?.hasBlob);
}

test('backup: v2 data + media round-trip restores settings, profiles, lineup, snapshots and older module data without orphans', () => withWorkspace(async source => {
  const site = await populateSite(source);
  const img = await storedAsset(source);
  const dest = await source.content.publish((await source.content.saveDraft(completeDestination(img))).id, { expectedVersion: 1 });
  const data = JSON.parse(JSON.stringify(await source.backup.exportData()));
  const media = JSON.parse(JSON.stringify(await source.backup.exportMedia()));
  assertEqual([data.schemasVersion, data.siteRecords.length, data.sitePublished.length, media.schemasVersion], [2, 4, 4, 1]);
  assert(/site settings, team profiles/.test(data.notice) && /does NOT contain image files/.test(data.notice));
  const before = await source.loadContext();
  await withWorkspace(async target => {
    await target.site.saveSettings(newSettings());
    const applied = await target.backup.importData(data);
    assertEqual([applied.siteRecords, applied.sitePublished, applied.teamProfiles, applied.settings, applied.keptSiteRecords], [4, 4, 2, true, 0]);
    assertEqual((await orphanedReferences(target)).length, 8, 'data backup alone restores image details but not files');
    assertEqual(await target.backup.importMedia(media), { restored: 4, added: 0 });
    assertEqual(await orphanedReferences(target), []);
    const ctx = await target.loadContext();
    assertEqual(JSON.stringify([...ctx.siteRecords.values()].sort((x, y) => x.id.localeCompare(y.id))), JSON.stringify([...before.siteRecords.values()].sort((x, y) => x.id.localeCompare(y.id))), 'site records differ');
    assertEqual(publishedTeam(ctx).map(p => p.id), [site.b.id, site.a.id], 'published order restored');
    assertEqual(ctx.siteRecords.get(LINEUP_ID).record.entries.find(e => e.memberId === site.a.id).visible, false, 'draft visibility restored');
    assertEqual(ctx.sitePublished.get(site.a.id).snapshot.bio, 'Plans safaris across the north.', 'published snapshot isolated from the draft');
    assertEqual(ctx.sitePublished.get(SETTINGS_ID).snapshot.company.name, 'Example Safari Co');
    assertEqual([ctx.records.get(dest.id).record.title, ctx.published.get(dest.id).route], ['Serengeti National Park', '/destinations/serengeti-national-park'], 'older module data restored');
    await assertRejects(target.media.remove(site.portrait.id), { code: 'dependency' });
  });
}));

test('backup: a schemasVersion 1 backup replaces content but keeps current settings, team and the images they use', () => withWorkspace(async target => {
  const site = await populateSite(target);
  const oldCover = await storedAsset(target);
  const oldDest = await target.content.saveDraft(completeDestination(oldCover));
  const siteBefore = JSON.stringify([...(await target.loadContext()).siteRecords.values()]);
  let legacy;
  await withWorkspace(async source => {
    const img = await storedAsset(source);
    await source.content.saveDraft({ ...completeDestination(img), title: 'Tarangire', slug: 'tarangire' });
    legacy = JSON.parse(JSON.stringify(await source.backup.exportData()));
  });
  delete legacy.siteRecords;
  delete legacy.sitePublished;
  legacy.schemasVersion = 1;
  const check = target.backup.validateDataBackup(legacy);
  assert(check.ok && check.legacy, JSON.stringify(check.errors));
  const applied = await target.backup.importData(legacy);
  assertEqual([applied.keptSiteRecords, applied.keptAssets], [4, 3]);
  const ctx = await target.loadContext();
  assertEqual([...ctx.records.values()].map(e => e.record.title), ['Tarangire'], 'content replaced');
  assert(!ctx.records.has(oldDest.id) && !ctx.assets.has(oldCover.id), 'replaced content and its unreferenced image details removed');
  assertEqual(JSON.stringify([...ctx.siteRecords.values()]), siteBefore, 'site records kept unchanged');
  assertEqual(publishedTeam(ctx).map(p => p.id), [site.b.id, site.a.id]);
  for (const a of [site.portrait, site.share, site.logo]) assert(ctx.assets.get(a.id)?.hasBlob, `kept image ${a.fileName} lost its file`);
  assertEqual(await orphanedReferences(target), []);
  const withSite = { ...legacy, siteRecords: [] };
  assert(target.backup.validateDataBackup(withSite).errors.some(e => /not part of a schemasVersion 1 backup/.test(e)), 'v1 backup with site collections accepted');
}));

test('backup: duplicate settings, broken team order and unsafe profile links are rejected completely', () => withWorkspace(async ws => {
  const site = await populateSite(ws);
  const base = JSON.parse(JSON.stringify(await ws.backup.exportData()));
  const attempt = async (mutate, pattern) => {
    const data = structuredClone(base);
    mutate(data);
    const err = await assertRejects(ws.backup.importData(data), { code: 'validation' });
    assert(err.errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(err.errors)}`);
  };
  const settingsEnv = d => d.siteRecords.find(e => e.kind === 'siteSettings');
  const lineupEnv = d => d.siteRecords.find(e => e.kind === 'teamLineup');
  const memberEnv = (d, id) => d.siteRecords.find(e => e.id === id);
  await attempt(d => d.siteRecords.push(structuredClone(settingsEnv(d))), /second site settings record|duplicated/);
  await attempt(d => { lineupEnv(d).record.entries = lineupEnv(d).record.entries.slice(1); }, /does not include the active profile/);
  await attempt(d => { lineupEnv(d).record.entries.push({ memberId: crypto.randomUUID(), visible: true }); }, /not in this backup/);
  await attempt(d => { memberEnv(d, site.b.id).record.links = [{ id: 'l', label: 'x', url: 'javascript:alert(1)' }]; }, /rejected for safety/);
  await attempt(d => { settingsEnv(d).record.contact.email = 'Name <x@example.com>'; }, /public email/);
  await attempt(d => { settingsEnv(d).record.apiKey = 'secret'; }, /not an allowed field/);
  await attempt(d => { memberEnv(d, site.a.id).record.status = 'draft'; }, /only published records may have a published snapshot/);
  await attempt(d => { delete d.sitePublished; }, /sitePublished: must be a list/);
  await attempt(d => { d.siteRecords.find(e => e.kind === 'teamMember').record.portrait.assetId = crypto.randomUUID(); }, /missing from the local media library/);
  const ctx = await ws.loadContext();
  assertEqual([ctx.siteRecords.size, ctx.sitePublished.size], [4, 4], 'rejected imports changed nothing');
}));

test('content regression: destinations still publish and site records never claim content routes', () => withWorkspace(async ws => {
  const img = await storedAsset(ws);
  await ws.site.saveSettings(newSettings());
  await ws.site.saveMember(completeMember(img, 'Serengeti National Park'));
  const dest = await ws.content.saveDraft(completeDestination(img));
  const pub = await ws.content.publish(dest.id, { expectedVersion: 1 });
  assertEqual(pub.record.status, 'published');
  const ctx = await ws.loadContext();
  assertEqual([...ctx.records.values()].map(e => e.kind), ['destination'], 'site records stay out of the content store');
  const copy = await ws.content.duplicate(dest.id);
  assertEqual(copy.record.slug, 'serengeti-national-park-copy');
  assertEqual((await ws.media.usage(img.id)).map(u => u.kind).sort(), ['destination', 'destination', 'destination', 'teamMember']);
  assertEqual(newRecord('tour', { title: 'T' }).kind, 'tour');
}));
