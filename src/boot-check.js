// Classic (non-module) script: explains how to open the CMS if the ES modules could not load,
// for example when index.html is opened directly from disk (file://).
window.addEventListener('load', function () {
  setTimeout(function () {
    if (window.__vionBooted) return;
    var note = document.createElement('div');
    note.setAttribute('role', 'alert');
    note.className = 'boot-error';
    note.textContent = location.protocol === 'file:'
      ? 'The CMS modules cannot load from a file:// address. In D:\\CMS\\vion-cms run "python -m http.server 5173 --bind 127.0.0.1" and open http://127.0.0.1:5173.'
      : 'The CMS scripts did not load. Check the browser console, then reload. Use a current version of Chrome, Edge, Firefox or Safari.';
    document.body.prepend(note);
  }, 1500);
});
