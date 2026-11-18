import { button, h } from './dom.js';
import { openDialog } from './dialog.js';
import { assetImage } from './media.js';

// One article section: a heading at the level the writer chooses, paragraph text, optional supporting
// photos (two sit side by side and stack on phones) and optional text that continues after the photos.
// Returns a document fragment for the article editor, or null when cancelled.
export async function composeBlogSection({pickImage, scope}) {
  const level = h('select', {class:'input'},
    ...['h1','h2','h3'].map(tag => h('option',{value:tag},tag.toUpperCase())));
  level.value = 'h2';
  const heading = h('input', {class:'input',type:'text',maxLength:250,required:true});
  const paragraph = h('textarea', {class:'input',rows:6,required:true});
  const after = h('textarea', {class:'input',rows:4});
  const photos = new Map();
  const photoList = h('div', {class:'section-photo-list'});

  const choosePhotos = button('Choose photos', {iconName:'image',onClick:async () => {
    const selected = await pickImage({title:'Choose section photos',multiple:true});
    if (!photoList.isConnected || !selected) return;
    for (const asset of selected) {
      if (photos.has(asset.id)) continue;
      const alt = h('input', {class:'input',type:'text',value:asset.alt || '',maxLength:500,required:true});
      const caption = h('input', {class:'input',type:'text',maxLength:500});
      const card = h('fieldset', {class:'panel'},
        h('legend', null, asset.fileName || 'Section photo'),
        scope ? assetImage(scope,asset.id,{alt:'',className:'review-thumb',asset}) : null,
        h('label', {class:'field'}, 'Image alt text', alt),
        h('label', {class:'field'}, 'Caption (optional)', caption),
        button('Remove photo', {onClick:() => {
          photos.delete(asset.id);
          card.remove();
          choosePhotos.focus();
        }}));
      photos.set(asset.id, {alt,caption});
      photoList.append(card);
    }
  }});

  const paragraphs = text => text.trim().split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
    .map(part => h('p',null,part));

  const fields = h('div', {class:'section-composer'},
    h('label',{class:'field'},'Heading level',level),
    h('label',{class:'field'},'Section heading',heading),
    h('label',{class:'field'},'Paragraph text',paragraph),
    h('fieldset',{class:'field'},h('legend',null,'Supporting photos (optional)'),
      h('p',{class:'field-hint'},'Two photos show side by side after the paragraph text and stack on phones.'),
      choosePhotos,photoList),
    h('label',{class:'field'},'Text after the photos (optional)',after));

  const modal = openDialog({title:'Add article section',wide:true,content:fields,actions:[
    {label:'Cancel'}, {label:'Add section',variant:'primary',onClick:close => {
      for (const input of [heading, paragraph, ...Array.from(photos.values(),photo=>photo.alt)]) {
        input.setCustomValidity(input.value.trim() ? '' : 'Complete this field.');
        if (!input.reportValidity()) return;
      }
      const section = document.createDocumentFragment();
      section.append(h(level.value,null,heading.value.trim()), ...paragraphs(paragraph.value));
      if (photos.size) {
        const group = h('div',{class:'article-section-photos'});
        for (const [id, {alt,caption}] of photos) {
          group.append(h('figure',{'data-asset-id':id,'data-alt':alt.value.trim()},
            caption.value.trim() ? h('figcaption',null,caption.value.trim()) : null));
        }
        section.append(group);
      }
      section.append(...paragraphs(after.value));
      close(section);
    }}
  ]});
  heading.focus();
  return modal.result;
}
