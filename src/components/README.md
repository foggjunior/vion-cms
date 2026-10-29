# Component boundary

Reusable, accessible UI building blocks. User text is only ever inserted as text nodes (`dom.js` `h()`), and URL
attributes pass through an allowlist.

- `dom.js`, `icons.js` — element builder, icons, live-region announcements, buttons.
- `fields.js` — labelled inputs with hint and error slots (`aria-describedby`, `aria-invalid`).
- `tabs.js` — WAI-ARIA tabs (arrow keys, Home/End).
- `repeater.js` — ordered repeaters with Move up/down/Remove buttons, focus retention and announcements;
  string lists built on it.
- `relation-picker.js` — filterable many-to-many picker that keeps draft/archived/missing references visible.
- `media.js`, `media-picker.js` — cover/gallery/share-image fields, object-URL scope (revoked on view close),
  upload + library picker dialog.
- `dialog.js`, `feedback.js` — modal `<dialog>` confirmations, toasts, status badges, notices.
