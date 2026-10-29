// Classic (non-module) script: explains how to open the CMS if the ES modules could not load, for example
// when index.html is opened directly from disk (file://), or when the browser mixes freshly downloaded files
// with older cached copies after an update (a module then lacks an export that a newer module imports).
(function () {
  var firstError = null;
  window.addEventListener('error', function (event) {
    if (!firstError && !window.__vionBooted) firstError = event.message || (event.error && String(event.error)) || null;
  });

  // Re-downloads the page and every same-origin script/style it fetched, bypassing the HTTP cache, then reloads.
  // Local records and images (IndexedDB) are not touched.
  function refreshAndReload(button) {
    button.disabled = true;
    button.textContent = 'Refreshing CMS files…';
    var urls = [location.href.split('#')[0]];
    var entries = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
    entries.forEach(function (entry) {
      if (entry.name.indexOf(location.origin + '/') === 0 && /\.(js|css|json)(\?|$)/.test(entry.name)) urls.push(entry.name);
    });
    Promise.all(urls.map(function (url) { return fetch(url, { cache: 'reload' }).catch(function () { return null; }); }))
      .then(function () { location.reload(); });
  }

  function paragraph(text) {
    var p = document.createElement('p');
    p.textContent = text;
    return p;
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (window.__vionBooted) return;
      var note = document.createElement('div');
      note.setAttribute('role', 'alert');
      note.className = 'boot-error';
      if (location.protocol === 'file:') {
        note.textContent = 'The CMS modules cannot load from a file:// address. In D:\\CMS\\vion-cms run "python tools/serve.py" and open http://127.0.0.1:5173.';
        document.body.prepend(note);
        return;
      }
      var staleCache = !!firstError && /export named|import not found|binding name/i.test(firstError);
      note.appendChild(paragraph('The CMS scripts did not load' + (firstError ? ': ' + firstError : '.')));
      note.appendChild(paragraph(staleCache
        ? 'This usually happens just after the CMS was updated: the browser reused older cached copies of some files. Refresh the CMS files below, or press Ctrl+F5 (Cmd+Shift+R on a Mac). Your local records and images are not affected. Serving the CMS with "python tools/serve.py" prevents this.'
        : 'Refresh the CMS files below or press Ctrl+F5. If the problem remains, check the browser console and use a current version of Chrome, Edge, Firefox or Safari.'));
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary-button';
      button.textContent = 'Refresh CMS files and reload';
      button.addEventListener('click', function () { refreshAndReload(button); });
      note.appendChild(button);
      document.body.prepend(note);
      button.focus();
    }, 1500);
  });
})();
