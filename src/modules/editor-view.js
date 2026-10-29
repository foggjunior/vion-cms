// Generic record editor used by the destination, accommodation and tour modules.
import { button, clear, h, icon, linkButton } from '../components/dom.js';
import { confirmDialog, messageDialog } from '../components/dialog.js';
import { envelopeBadges, errorDetails, notice, toast } from '../components/feedback.js';
import { checkboxField, fieldIdFor, fieldWrap, selectControl, textControl } from '../components/fields.js';
import { createTabs } from '../components/tabs.js';
import { stringList } from '../components/repeater.js';
import { relationOptions, relationPicker } from '../components/relation-picker.js';
import { MediaUrlScope, coverField, galleryField, shareImageField } from '../components/media.js';
import { openMediaPicker } from '../components/media-picker.js';
import { formToRecord, hasUnpublishedChanges, newRecord, publicName, recordToForm } from './shared/records.js';
import { findRouteConflict, routeFor, slugify } from './shared/routes.js';
import { SEO_DESCRIPTION_ADVICE, SEO_TITLE_ADVICE, errorsOnly, hasErrors, validateDraft, validatePublish } from './shared/validation.js';
import { formatDateTime, formatTime, truncateWords } from './shared/format.js';
import { describePrice } from './shared/pricing.js';

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

export async function createEditorView({ def, id, app }) {
  const ws = await app.workspace();
  let ctx = await ws.loadContext();
  let env = id ? ctx.records.get(id) || null : null;
  if (id && (!env || env.kind !== def.kind)) return notFoundView(def);

  let model = recordToForm(env ? env.record : newRecord(def.kind));
  let baseline = JSON.stringify(model);
  let isNew = !env;
  let validationMode = null;
  let liveTimer = null;
  let busy = false;
  let leaving = false;
  let pendingFocusAction = null;
  const scope = new MediaUrlScope(ws.media);
  const readOnly = () => env?.record.status === 'archived';
  let slugAuto = !model.slug && !(env?.workflow.routeHistory.length);

  const root = h('div', { class: 'editor' });
  const titleEl = h('h1', { class: 'editor-title', tabindex: '-1' });
  const badgesEl = h('div', { class: 'editor-badges' });
  const statusEl = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  const actionsEl = h('div', { class: 'editor-actions' });
  const bannersEl = h('div', { class: 'editor-banners' });
  const summaryEl = h('div', { class: 'issue-summary', tabindex: '-1', hidden: true });
  const bar = h('div', { class: 'editor-bar' },
    h('div', { class: 'editor-bar-main' },
      h('a', { class: 'back-link', href: `#/${def.path}` }, icon('back'), `All ${def.plural.toLowerCase()}`),
      titleEl, h('div', { class: 'editor-meta' }, badgesEl, statusEl)),
    actionsEl);

  const isDirty = () => !readOnly() && JSON.stringify(model) !== baseline;
  const kindLabel = def.label.toLowerCase();

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  // Only edits move the status to "unsaved"; save/publish outcomes (including errors) stay visible until then.
  function changed() {
    if (!busy) {
      if (isDirty()) setStatus('dirty', isNew ? 'Not saved yet' : 'Unsaved changes');
      else if (statusEl.dataset.state === 'dirty') setStatus('idle', 'No unsaved changes');
    }
    renderBar();
    if (validationMode) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => runValidation(validationMode, { focus: false }), 350);
    }
  }

  // ---- field binding helpers handed to section renderers ----
  const ed = {
    def, get model() { return model; }, get ctx() { return ctx; }, get env() { return env; }, get readOnly() { return readOnly(); }, scope, changed,
    text(path, { label, hint, required, multiline, rows, placeholder, inputmode, wide, counter, onInput, list } = {}) {
      const fid = fieldIdFor(path);
      let counterEl = null;
      const updateCounter = () => { if (counterEl) counterEl.textContent = `${String(getPath(model, path) || '').length} characters${counter ? ` · around ${counter} advised` : ''}`; };
      const control = textControl({
        id: fid, value: getPath(model, path) ?? '', multiline, rows, placeholder, inputmode, list, readOnly: readOnly(),
        onInput: value => { setPath(model, path, value); onInput?.(value); updateCounter(); changed(); }
      });
      const wrap = fieldWrap({ id: fid, label, hint, required, control, wide: wide ?? multiline });
      if (counter) { counterEl = h('p', { class: 'counter' }); wrap.insertBefore(counterEl, wrap.querySelector('.field-error')); updateCounter(); }
      return wrap;
    },
    select(path, { label, hint, required, options, emptyValue = '', onChange } = {}) {
      const fid = fieldIdFor(path);
      const control = selectControl({ id: fid, value: getPath(model, path) ?? '', options, onChange: value => { setPath(model, path, value === '' ? emptyValue : value); onChange?.(value); changed(); } });
      control.disabled = readOnly();
      return fieldWrap({ id: fid, label, hint, required, control });
    },
    checkbox(path, { label, hint, onChange } = {}) {
      const field = checkboxField({ id: fieldIdFor(path), label, hint, checked: !!getPath(model, path), onChange: value => { setPath(model, path, value); onChange?.(value); changed(); } });
      field.querySelector('input').disabled = readOnly();
      return field;
    },
    list(path, { label, hint, noun, placeholder } = {}) {
      return stringList({ path, label, hint, noun, placeholder, values: getPath(model, path), onChange: changed, readOnly: readOnly() });
    },
    relations(path, { legend, kind, hint, noun } = {}) {
      return relationPicker({ path, legend, hint, noun, options: relationOptions(ctx, kind, { excludeId: kind === def.kind ? model.id : undefined }), selected: getPath(model, path), onChange: changed, readOnly: readOnly() });
    },
    async pick(options) {
      const picked = await openMediaPicker({ workspace: ws, ...options });
      if (picked?.length) for (const asset of await ws.media.list()) ctx.assets.set(asset.id, asset);
      return picked;
    },
    slugField() { return slugField(); },
    refreshSection(sectionId) { renderSection(sectionId); },
    group(title, ...children) { return h('div', { class: 'form-group' }, title ? h('h3', { class: 'group-title' }, title) : null, h('div', { class: 'form-grid' }, children)); }
  };

  function slugField() {
    const fid = fieldIdFor('slug');
    const routeEl = h('p', { class: 'route-preview' });
    const updateRoute = () => {
      const route = routeFor(def.kind, model.slug.trim());
      clear(routeEl).append(icon('globe'), route ? `Local route: ${route}` : 'No route yet — a slug is required before publishing.');
    };
    const control = textControl({
      id: fid, value: model.slug, inputmode: 'url', readOnly: readOnly(), placeholder: slugify(model.title) || `example-${kindLabel}`,
      onInput: value => { model.slug = value; slugAuto = false; updateRoute(); changed(); }
    });
    control.addEventListener('blur', () => {
      const conflict = model.slug && findRouteConflict(def.kind, model.slug.trim(), model.id, ctx);
      const slot = root.querySelector(`#${fid}-error`);
      if (conflict && slot) { slot.hidden = false; slot.className = 'field-error is-error'; slot.textContent = `Error: ${conflict.message}`; control.setAttribute('aria-invalid', 'true'); }
    });
    ed.updateSlugFromTitle = () => {
      if (!slugAuto) return;
      model.slug = slugify(model.title);
      control.value = model.slug;
      updateRoute();
    };
    const published = env?.workflow.lastPublishedRoute;
    const wrap = fieldWrap({
      id: fid, label: 'Slug', required: 'publish', control,
      hint: published
        ? `Published at ${published}. Changing the slug plans a local 308 redirect from the old address when you republish; the live website is not changed.`
        : 'The last part of the page address. Generated from the first title you enter, then kept unless you edit it. Lowercase letters, numbers and hyphens.'
    });
    wrap.insertBefore(routeEl, wrap.querySelector('.field-error'));
    if (!readOnly()) wrap.insertBefore(h('div', { class: 'btn-row' }, button('Generate from title', { variant: 'ghost', onClick: () => { model.slug = slugify(model.title); slugAuto = false; control.value = model.slug; updateRoute(); changed(); } })), wrap.querySelector('.field-error'));
    updateRoute();
    return wrap;
  }

  // ---- sections and tabs ----
  const sections = def.sections.map(s => (typeof s === 'string' ? BUILTIN_SECTIONS[s] : s));
  const containers = new Map(sections.map(s => [s.id, h('div', { class: 'section-body' })]));
  const tabs = createTabs({
    id: `editor-${def.kind}`, tabs: sections.map(s => ({ id: s.id, label: s.label, content: containers.get(s.id) })),
    onSelect: tabId => { if (tabId === 'preview' && containers.get('preview').childElementCount) renderSection('preview'); }
  });

  function renderSection(sectionId) {
    const section = sections.find(s => s.id === sectionId);
    const container = containers.get(sectionId);
    const activeId = container.contains(document.activeElement) ? document.activeElement.id : null;
    clear(container);
    const content = section.render(ed);
    container.append(...[].concat(content).filter(Boolean));
    if (readOnly()) container.querySelectorAll('input, textarea, select').forEach(el => { if (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') el.disabled = true; else el.readOnly = true; });
    if (activeId) container.querySelector(`#${CSS.escape(activeId)}`)?.focus({ preventScroll: true });
    if (validationMode) runValidation(validationMode, { focus: false });
  }

  function renderAllSections() {
    const activeId = root.contains(document.activeElement) ? document.activeElement.id : null;
    for (const s of sections) renderSection(s.id);
    if (activeId && !root.contains(document.activeElement)) root.querySelector(`#${CSS.escape(activeId)}`)?.focus({ preventScroll: true });
  }

  // ---- header ----
  function renderBar() {
    const recordTitle = model.title?.trim();
    titleEl.textContent = recordTitle || (isNew ? `New ${kindLabel}` : `Untitled ${kindLabel}`);
    clear(badgesEl).append(env ? envelopeBadges(env) : h('span', { class: 'status-badge status-draft' }, 'Not saved yet'));
    if (!statusEl.dataset.state) setStatus('idle', readOnly() ? 'Archived — read only' : env ? `Saved ${formatDateTime(env.record.updatedAt)}` : 'Nothing entered yet');
    // Re-rendering the buttons must not drop keyboard focus.
    const focusedAction = actionsEl.contains(document.activeElement) ? pendingFocusAction || document.activeElement.dataset.action : null;
    clear(actionsEl);
    const status = env?.record.status;
    if (readOnly()) {
      actionsEl.append(button('Restore to draft', { variant: 'primary', iconName: 'restore', onClick: doRestore, 'data-action': 'restore' }));
    } else {
      actionsEl.append(button('Save draft', { variant: 'secondary', iconName: 'check', onClick: () => doSave(), disabled: busy, 'data-action': 'save' }));
      const published = status === 'published';
      const upToDate = published && !hasUnpublishedChanges(env) && !isDirty();
      actionsEl.append(button(published ? (upToDate ? 'Published' : 'Publish changes') : 'Publish', {
        variant: 'primary', iconName: 'globe', onClick: doPublish, disabled: busy || upToDate, 'data-action': 'publish',
        title: upToDate ? 'The published snapshot matches the saved draft.' : 'Publish to the local preview only'
      }));
    }
    if (env) {
      actionsEl.append(linkButton('Preview', `#/${def.path}/${env.id}/preview`, { iconName: 'eye', variant: 'ghost', 'data-action': 'preview' }));
      actionsEl.append(button('Duplicate', { variant: 'ghost', iconName: 'copy', onClick: doDuplicate, disabled: busy, 'data-action': 'duplicate' }));
      if (status === 'published') actionsEl.append(button('Unpublish', { variant: 'ghost', iconName: 'eye', onClick: doUnpublish, disabled: busy, 'data-action': 'unpublish' }));
      if (status !== 'archived') actionsEl.append(button('Archive', { variant: 'ghost-danger', iconName: 'archive', onClick: doArchive, disabled: busy, 'data-action': 'archive' }));
    }
    if (focusedAction) {
      const target = actionsEl.querySelector(`[data-action="${focusedAction}"]`);
      if (target && !target.disabled) { target.focus({ preventScroll: true }); pendingFocusAction = null; }
      else { pendingFocusAction = focusedAction; actionsEl.querySelector('button:not([disabled]), a')?.focus({ preventScroll: true }); }
    }
    app.setTitle(`${recordTitle || `New ${kindLabel}`} · ${def.plural}`);
  }

  function renderBanners(extra = []) {
    clear(bannersEl);
    if (readOnly()) bannersEl.append(notice('warning', h('strong', null, 'This record is archived. '), `It is kept with its data and route history but is read-only and hidden from local preview. ${env.workflow.priorStatus ? `It was ${env.workflow.priorStatus} before archiving. ` : ''}Restore it to draft to edit; republishing is a separate step.`));
    if (env?.record.status === 'published' && hasUnpublishedChanges(env)) bannersEl.append(notice('info', 'The saved draft has changes that are not published. The local preview still shows the published snapshot until you choose “Publish changes”.'));
    for (const node of extra) bannersEl.append(node);
  }

  // ---- validation display ----
  function locate(path) {
    for (let p = path; p; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
      const fid = fieldIdFor(p);
      const slot = root.querySelector(`#${CSS.escape(fid)}-error`);
      if (slot) return { slot, control: root.querySelector(`#${CSS.escape(fid)}`), panel: slot.closest('[role="tabpanel"]') };
    }
    return null;
  }

  function focusIssue(path) {
    const target = locate(path);
    if (!target) { summaryEl.focus(); return; }
    const sectionId = target.panel?.id.split('-panel-')[1];
    if (sectionId) tabs.select(sectionId);
    let control = target.control || target.slot;
    if (control && !control.matches('input, textarea, select, button, a[href]')) control = control.querySelector('input, textarea, select, button') || control;
    if (!control.matches('input, textarea, select, button, a[href]')) control.tabIndex = -1;
    control.focus({ preventScroll: true });
    control.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function applyIssues(issues, heading) {
    root.querySelectorAll('.field-error').forEach(slot => { slot.hidden = true; slot.textContent = ''; slot.className = 'field-error'; });
    root.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    const counts = new Map();
    const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    for (const issue of sorted) {
      const target = locate(issue.path);
      if (!target) continue;
      const line = h('span', { class: issue.severity === 'error' ? 'msg-error' : 'msg-warning' }, `${issue.severity === 'error' ? 'Error' : 'Warning'}: ${issue.message}`);
      target.slot.hidden = false;
      target.slot.className = 'field-error';
      target.slot.append(line);
      if (issue.severity === 'error') target.control?.setAttribute('aria-invalid', 'true');
      const sectionId = target.panel?.id.split('-panel-')[1];
      if (sectionId) {
        const c = counts.get(sectionId) || { error: 0, warning: 0 };
        c[issue.severity] += 1;
        counts.set(sectionId, c);
      }
    }
    for (const s of sections) {
      const c = counts.get(s.id);
      tabs.setBadge(s.id, c?.error || c?.warning || 0, c?.error ? 'error' : 'warning');
    }
    clear(summaryEl);
    summaryEl.hidden = !sorted.length;
    summaryEl.className = 'issue-summary';
    if (!sorted.length) return;
    const errors = sorted.filter(i => i.severity === 'error').length;
    summaryEl.className = `issue-summary ${errors ? 'has-errors' : 'has-warnings'}`;
    summaryEl.append(
      h('h2', null, heading || (errors ? `${errors} problem${errors === 1 ? '' : 's'} to fix` : 'Warnings (these do not block publishing)')),
      h('ul', null, sorted.map(issue => h('li', { class: issue.severity === 'error' ? 'msg-error' : 'msg-warning' },
        h('button', { type: 'button', class: 'link-button', on: { click: () => focusIssue(issue.path) } }, `${issue.severity === 'error' ? 'Error' : 'Warning'}: ${issue.message}`)))));
  }

  async function runValidation(mode, { focus = true } = {}) {
    const { record, issues: conversionIssues } = formToRecord(model);
    const issues = mode === 'publish' ? validatePublish(record, ctx, { conversionIssues }) : validateDraft(record, ctx, { conversionIssues });
    applyIssues(issues, mode === 'publish' && hasErrors(issues) ? `Not ready to publish — ${errorsOnly(issues).length} problem${errorsOnly(issues).length === 1 ? '' : 's'} to fix` : null);
    if (focus && hasErrors(issues)) focusIssue(errorsOnly(issues)[0].path);
    return { record, issues, conversionIssues };
  }

  // ---- persistence actions ----
  function rebuild(nextEnv) {
    env = nextEnv;
    model = recordToForm(env.record);
    baseline = JSON.stringify(model);
    slugAuto = !model.slug && !env.workflow.routeHistory.length;
    renderAllSections();
    renderBanners();
    renderBar();
  }

  function keepEditsAfterWrite(nextEnv) {
    env = nextEnv;
    const { version, updatedAt, createdAt, status } = nextEnv.record;
    Object.assign(model, { version, updatedAt, createdAt, status });
    baseline = JSON.stringify(recordToForm(nextEnv.record));
  }

  function handleError(err, action) {
    busy = false;
    if (err.code === 'validation' && err.issues) {
      applyIssues(err.issues);
      focusIssue(err.issues[0]?.path);
      setStatus('error', `Not ${action} — fix the highlighted fields.`);
    } else if (err.code === 'stale') {
      setStatus('error', `Not ${action} — this record changed elsewhere.`);
      renderBanners([notice('error', h('strong', null, 'Your change was not saved. '), err.message, ' ', button('Reload latest version', { variant: 'secondary', onClick: reloadLatest }))]);
    } else if (err.code === 'dependency') {
      setStatus('error', `Not ${action}.`);
      messageDialog({ title: `Cannot ${action === 'archived' ? 'archive' : 'unpublish'} yet`, body: errorDetails(err) });
    } else {
      setStatus('error', err.message || `Not ${action}.`);
      renderBanners([notice('error', h('strong', null, `Not ${action}. `), err.message || String(err))]);
      toast(err.message || `Not ${action}.`, { tone: 'error' });
    }
    renderBar();
    return null;
  }

  async function reloadLatest() {
    if (isDirty() && !(await confirmDialog({ title: 'Discard your unsaved changes?', body: 'Reloading shows the latest stored version. Your unsaved edits in this form will be lost.', confirmLabel: 'Discard and reload', danger: true }))) return;
    ctx = await ws.loadContext();
    const latest = ctx.records.get(model.id);
    if (latest) { rebuild(latest); setStatus('idle', `Reloaded version ${latest.record.version}`); }
  }

  async function doSave() {
    if (busy) return null;
    if (readOnly()) return env;
    if (!isNew && !isDirty()) {
      if (validationMode) { clearTimeout(liveTimer); runValidation(validationMode, { focus: false }); }
      setStatus('idle', 'No changes to save.');
      return env;
    }
    busy = true;
    setStatus('saving', 'Checking…');
    renderBar();
    try {
      ctx = await ws.loadContext();
      const submitted = JSON.stringify(model);
      const { record, issues, conversionIssues } = await runValidation('draft');
      if (hasErrors(issues)) {
        busy = false;
        validationMode = 'draft';
        setStatus('error', 'Not saved — fix the highlighted fields.');
        renderBar();
        return null;
      }
      setStatus('saving', 'Saving…');
      const saved = await ws.content.saveDraft(record, { expectedVersion: isNew ? null : env.record.version, conversionIssues });
      busy = false;
      const wasNew = isNew;
      isNew = false;
      ctx = await ws.loadContext();
      validationMode = null;
      if (JSON.stringify(model) === submitted) {
        rebuild(saved);
      } else {
        // Edits made while the save was in flight are kept in the form (and stay unsaved), never discarded.
        keepEditsAfterWrite(saved);
        renderBanners();
        renderBar();
      }
      const warnings = validateDraft(saved.record, ctx).filter(i => i.severity === 'warning');
      applyIssues(warnings);
      setStatus('saved', `Draft saved ${formatTime(saved.record.updatedAt)}${saved.record.status === 'published' ? ' · published version unchanged' : ''}${isDirty() ? ' · newer edits not saved yet' : ''}`);
      if (wasNew) {
        app.replaceRoute(`#/${def.path}/${saved.id}`);
        app.setNav({ breadcrumb: `${def.navGroup} / ${def.listLabel}`, navGroup: def.navGroup, navLabel: def.listLabel });
      }
      return saved;
    } catch (err) {
      return handleError(err, 'saved');
    }
  }

  async function doPublish() {
    if (busy || readOnly()) return;
    if (isNew || isDirty()) {
      const saved = await doSave();
      if (!saved) return;
    }
    ctx = await ws.loadContext();
    const issues = validatePublish(env.record, ctx);
    validationMode = 'publish';
    if (hasErrors(issues)) {
      applyIssues(issues, `Not ready to publish — ${errorsOnly(issues).length} problem${errorsOnly(issues).length === 1 ? '' : 's'} to fix`);
      focusIssue(errorsOnly(issues)[0].path);
      setStatus('error', 'Not published — fix the listed problems.');
      return;
    }
    const route = routeFor(def.kind, env.record.slug);
    const previous = env.workflow.lastPublishedRoute;
    const warnings = issues.filter(i => i.severity === 'warning');
    if ((previous && previous !== route) || warnings.length) {
      const body = h('div', null,
        previous && previous !== route ? h('p', null, `The page address changes from ${previous} to ${route}. A local 308 redirect entry will be planned. No live website URL is changed.`) : null,
        warnings.length ? h('div', null, h('p', null, 'These warnings do not block publishing:'), h('ul', { class: 'error-list' }, warnings.map(w => h('li', null, w.message)))) : null,
        h('p', null, 'Publishing makes this saved version visible in the local preview only.'));
      if (!(await confirmDialog({ title: `Publish “${env.record.title}” locally?`, body, confirmLabel: 'Publish locally' }))) return;
    }
    busy = true;
    setStatus('saving', 'Publishing to local preview…');
    renderBar();
    try {
      const submitted = JSON.stringify(model);
      const published = await ws.content.publish(env.id, { expectedVersion: env.record.version });
      busy = false;
      ctx = await ws.loadContext();
      validationMode = null;
      if (JSON.stringify(model) === submitted) rebuild(published);
      else { keepEditsAfterWrite(published); renderBanners(); renderBar(); }
      applyIssues(warnings);
      const redirect = published.redirectPlan?.add[0];
      setStatus('saved', `Published locally ${formatTime(published.workflow.lastPublishedAt)} (revision ${published.workflow.publishedRevision})`);
      toast(redirect ? `Published locally. Planned local redirect ${redirect.from} → ${redirect.to}.` : 'Published to the local preview.');
    } catch (err) {
      handleError(err, 'published');
    }
  }

  async function doUnpublish() {
    if (isDirty()) { messageDialog({ title: 'Save or discard changes first', body: 'You have unsaved changes. Save the draft (or reload to discard) before unpublishing.' }); return; }
    const ok = await confirmDialog({ title: `Unpublish “${env.record.title}”?`, body: 'The published snapshot is removed from the local preview. The record and its working draft are kept as a draft, and you can publish again later.', confirmLabel: 'Unpublish', danger: true });
    if (!ok) return;
    busy = true;
    try {
      const next = await ws.content.unpublish(env.id, { expectedVersion: env.record.version });
      busy = false;
      ctx = await ws.loadContext();
      rebuild(next);
      setStatus('saved', 'Unpublished — no longer visible in local preview.');
      toast('Unpublished from the local preview.');
    } catch (err) {
      handleError(err, 'unpublished');
    }
  }

  async function doArchive() {
    if (isDirty()) { messageDialog({ title: 'Save or discard changes first', body: 'You have unsaved changes. Save the draft (or reload to discard) before archiving.' }); return; }
    const published = env.record.status === 'published';
    const ok = await confirmDialog({
      title: `Archive “${env.record.title}”?`,
      body: `${published ? 'It will be removed from the local preview. ' : ''}The record, its images and its route history are kept. Archived records are read-only and keep their slug reserved. You can restore it to draft later.`,
      confirmLabel: 'Archive', danger: true
    });
    if (!ok) return;
    busy = true;
    try {
      const next = await ws.content.archive(env.id, { expectedVersion: env.record.version });
      busy = false;
      ctx = await ws.loadContext();
      rebuild(next);
      setStatus('saved', 'Archived.');
      toast(`Archived “${next.record.title}”.`);
    } catch (err) {
      handleError(err, 'archived');
    }
  }

  async function doRestore() {
    busy = true;
    try {
      const next = await ws.content.restore(env.id, { expectedVersion: env.record.version });
      busy = false;
      ctx = await ws.loadContext();
      rebuild(next);
      setStatus('saved', 'Restored to draft. Publish again when ready.');
      toast('Restored to draft. It is not published until you publish it again.');
    } catch (err) {
      handleError(err, 'restored');
    }
  }

  async function doDuplicate() {
    if (isDirty() && !(await confirmDialog({ title: 'Duplicate the last saved version?', body: 'The copy is made from the last saved draft; your unsaved changes here are not included.', confirmLabel: 'Duplicate saved version' }))) return;
    try {
      const copy = await ws.content.duplicate(env.id);
      toast(`Created draft copy “${copy.record.title}”.`);
      leaving = true;
      app.navigate(`#/${def.path}/${copy.id}`);
    } catch (err) {
      handleError(err, 'duplicated');
    }
  }

  // Another tab saved this record: warn that saving will be rejected rather than silently overwriting.
  const offEvents = ws.events.on(event => {
    if (!event.remote || !env || event.id !== env.id) return;
    renderBanners([notice('warning', h('strong', null, 'This record was changed in another tab or window. '), 'Saving here will be rejected to protect that change. ', button('Reload latest version', { variant: 'secondary', onClick: reloadLatest }))]);
  });

  root.append(bar, bannersEl, summaryEl, h('div', { class: 'editor-tabs' }, tabs.list, h('div', { class: 'tabpanels' }, tabs.panels)));
  renderAllSections();
  renderBanners();
  renderBar();

  return {
    el: root,
    title: titleEl.textContent,
    breadcrumb: `${def.navGroup} / ${isNew ? def.addLabel : def.listLabel}`,
    navLabel: isNew ? def.addLabel : def.listLabel,
    navGroup: def.navGroup,
    isDirty: () => !leaving && isDirty(),
    mounted() { titleEl.focus({ preventScroll: true }); },
    destroy() { clearTimeout(liveTimer); offEvents(); scope.revokeAll(); }
  };
}

function notFoundView(def) {
  return {
    el: h('div', { class: 'panel empty-panel' }, icon('alert'), h('h1', { tabindex: '-1' }, `${def.label} not found`),
      h('p', null, 'This record does not exist in this browser’s local storage. It may have been created in another browser, or local data was cleared or replaced by an import.'),
      linkButton(`Back to ${def.plural.toLowerCase()}`, `#/${def.path}`, { variant: 'primary' })),
    title: `${def.label} not found`, breadcrumb: `${def.navGroup} / ${def.listLabel}`, navLabel: def.listLabel, navGroup: def.navGroup
  };
}

// ---- built-in sections shared by every content type ----
function mediaSection(ed) {
  const pick = options => ed.pick(options);
  const cover = coverField({ model: ed.model, ctx: ed.ctx, scope: ed.scope, pick, onChange: ed.changed, readOnly: ed.readOnly, hint: 'Shown on cards and as the page hero. Distinct from the gallery order below.' });
  return [
    h('p', { class: 'section-intro' }, 'Upload JPEG, PNG or WebP images (up to 10 MB) or reuse images from the local library. Images are stored only in this browser.'),
    cover.el,
    galleryField({ items: ed.model.gallery, ctx: ed.ctx, scope: ed.scope, pick, onChange: ed.changed, readOnly: ed.readOnly })
  ];
}

function seoSection(ed) {
  const { model } = ed;
  const fallback = h('div', { class: 'seo-preview' });
  const updateFallback = () => {
    const record = formToRecord(model).record;
    const title = record.seo.title || publicName(record);
    const description = record.seo.description || truncateWords(record.kind === 'tour' ? record.summary || record.overview : record.kind === 'destination' ? record.overview : record.description, SEO_DESCRIPTION_ADVICE);
    clear(fallback).append(
      h('p', { class: 'seo-route' }, routeFor(record.kind, record.slug) || '(no slug yet)'),
      h('p', { class: 'seo-title' }, title || 'Untitled'),
      h('p', { class: 'seo-desc' }, description || 'No description available yet — add an overview or an SEO description.'),
      record.seo.noindex ? h('p', { class: 'tag tag-warn' }, 'noindex — search engines asked not to index') : null);
  };
  updateFallback();
  const refresh = () => updateFallback();
  return [
    h('p', { class: 'section-intro' }, 'Optional overrides. When empty, the public name and the first part of the overview are used. Length guidance is advisory only and not a confirmed CMS rule.'),
    ed.group('Search appearance',
      ed.text('seo.title', { label: 'SEO title', hint: `Leave empty to use the public name. Around ${SEO_TITLE_ADVICE} characters is advised.`, counter: SEO_TITLE_ADVICE, onInput: refresh }),
      ed.text('seo.description', { label: 'SEO description', multiline: true, rows: 3, counter: SEO_DESCRIPTION_ADVICE, hint: 'Leave empty to generate from the overview.', onInput: refresh }),
      ed.checkbox('seo.noindex', { label: 'Ask search engines not to index this page (noindex)', hint: 'Independent of publishing and archiving.', onChange: refresh })),
    shareImageField({ model, ctx: ed.ctx, scope: ed.scope, pick: o => ed.pick(o), onChange: ed.changed, readOnly: ed.readOnly }).el,
    h('div', { class: 'form-group' }, h('h3', { class: 'group-title' }, 'Generated preview (local)'), fallback,
      h('p', { class: 'field-hint' }, 'Canonical route shown from the current slug. Production metadata is never fetched or changed.'))
  ];
}

function previewSection(ed) {
  const { record, issues: conversionIssues } = formToRecord(ed.model);
  const issues = validatePublish({ ...record, status: ed.env?.record.status === 'archived' ? 'archived' : 'draft' }, ed.ctx, { conversionIssues });
  const errors = errorsOnly(issues);
  const warnings = issues.filter(i => i.severity === 'warning');
  const env = ed.env;
  const price = record.kind === 'tour' ? describePrice(record.pricing) : null;
  return [
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Publish readiness (current form)'),
      errors.length
        ? h('div', null, h('p', { class: 'msg-error' }, `${errors.length} problem${errors.length === 1 ? '' : 's'} must be fixed before publishing:`), h('ul', { class: 'error-list' }, errors.map(i => h('li', null, i.message))))
        : h('p', { class: 'msg-ok' }, icon('check'), ' Meets the proposed publication minimum.'),
      warnings.length ? h('div', null, h('p', { class: 'msg-warning' }, 'Warnings (not blocking):'), h('ul', { class: 'error-list' }, warnings.map(i => h('li', null, i.message)))) : null,
      price ? h('p', null, h('strong', null, 'Price display: '), price.text) : null),
    h('div', { class: 'form-group' },
      h('h3', { class: 'group-title' }, 'Local previews'),
      h('p', { class: 'field-hint' }, 'Previews render the saved draft or the published snapshot — not unsaved form changes. Save first to preview your latest edits.'),
      env ? h('div', { class: 'btn-row' },
        linkButton('Preview saved draft', `#/${ed.def.path}/${env.id}/preview?rev=draft`, { iconName: 'eye' }),
        env.record.status === 'published' ? linkButton('Preview published snapshot', `#/${ed.def.path}/${env.id}/preview?rev=published`, { iconName: 'globe' }) : h('span', { class: 'muted' }, 'Not published — nothing is visible on the local preview site.'))
        : h('p', { class: 'muted' }, 'Save the draft to enable previews.'))
  ];
}

const BUILTIN_SECTIONS = {
  media: { id: 'media', label: 'Media', render: mediaSection },
  seo: { id: 'seo', label: 'SEO', render: seoSection },
  preview: { id: 'preview', label: 'Preview', render: previewSection }
};
