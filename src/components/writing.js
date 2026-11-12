import {button,h} from './dom.js';
import {messageDialog,openDialog} from './dialog.js';
import {assetImage} from './media.js';

const richPrefix = '@vion-rich:';
const richTags = new Set(['p','div','h2','h3','strong','b','em','i','u','s','strike','del','span','font','ol','ul','li','a','blockquote','br']);

const assetIdPattern = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';

export function writingAssetIds(text) {
  if (!String(text || '').startsWith(richPrefix)) return [];
  const figures = new RegExp('<figure data-asset-id="(' + assetIdPattern + ')"', 'gi');
  return [...new Set([...text.matchAll(figures)].map(match => match[1]))];
}

function richFragment(html, sectionLevel) {
  const template = document.createElement('template');
  template.innerHTML = html;
  let hasSection = false;
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.localName;
    if (['script','style','iframe','object','svg','math','template'].includes(tag)) return null;
    if (tag === 'figure') {
      const assetId = node.getAttribute('data-asset-id') || '';
      const alt = (node.getAttribute('data-alt') || '').trim().slice(0, 500);
      if (!new RegExp('^' + assetIdPattern + '$', 'i').test(assetId) || !alt) return null;
      const caption = node.querySelector(':scope > figcaption')?.textContent.trim().slice(0, 500);
      return h('figure', {'data-asset-id':assetId,'data-alt':alt},
        caption ? h('figcaption',null,caption) : null);
    }
    const children = [...node.childNodes].flatMap(child => copy(child) || []);
    if (!richTags.has(tag) || (tag === 'a' && !httpsLink(node.getAttribute('href') || ''))) return children;
    let outputTag = tag === 'font' ? 'span' : tag;
    if (sectionLevel && (tag === 'h2' || tag === 'h3')) {
      outputTag = 'h' + (sectionLevel + Number(tag === 'h3' && hasSection));
      hasSection = true;
    }
    const element = h(outputTag, tag === 'a' ? {href:node.getAttribute('href')} : null, children);
    for (const property of ['color','backgroundColor','fontWeight','fontStyle','textDecorationLine']) {
      const value = property === 'color' && tag === 'font' ? node.getAttribute('color') : node.style[property];
      if (value && (property === 'color' || property === 'backgroundColor'
        ? /^(#[\da-f]{3,8}|rgba?\([\d,. %]+\)|transparent)$/i.test(value)
        : /^(bold|700|italic|underline|line-through|underline line-through)$/.test(value))) {
        element.style[property] = value;
      }
    }
    return element;
  }
  const fragment = document.createDocumentFragment();
  fragment.append(...[...template.content.childNodes].flatMap(node => copy(node) || []));
  return fragment;
}

export function writingPlainText(text) {
  const value = String(text || '');
  if (!value.startsWith(richPrefix)) return value;
  const fragment = richFragment(value.slice(richPrefix.length));
  for (const block of fragment.querySelectorAll('p,div,h2,h3,li,blockquote,br')) block.after(' ');
  return fragment.textContent.replace(/\s+/g, ' ').trim();
}

export function sectionHeadings(text) {
  if (String(text || '').startsWith(richPrefix)) {
    return [...text.matchAll(/<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/gi)]
      .map(match => match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()).filter(Boolean);
  }
  return String(text||'').split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^ {0,3}##[ \t]+(.+?)\s*$/);
    return match ? [match[1].trim()] : [];
  }).filter(Boolean);
}

function httpsLink(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password;
  } catch {
    return false;
  }
}

function inline(text) {
  const result=[];
  const pattern=/\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let cursor=0;
  for(const match of text.matchAll(pattern)){
    result.push(text.slice(cursor,match.index));
    if(match[1])result.push(h('strong',null,match[1]));
    else if(match[2])result.push(h('em',null,match[2]));
    else result.push(httpsLink(match[4])?h('a',{href:match[4]},match[3]):match[0]);
    cursor=match.index+match[0].length;
  }
  result.push(text.slice(cursor));
  return result;
}

function showPhotos(root, scope, remove) {
  for (const figure of root.querySelectorAll('figure[data-asset-id]')) {
    if (figure.querySelector('.writing-photo-image')) continue;
    const {assetId,alt} = figure.dataset;
    const image = scope ? assetImage(scope,assetId,{alt,className:'writing-photo-image'})
      : h('p',{class:'writing-photo-image'},alt);
    figure.prepend(image);
    if (remove) {
      figure.contentEditable = 'false';
      const action = button('Remove photo',{'aria-label':'Remove photo: '+alt,onClick:()=>remove(figure)});
      figure.prepend(action);
    }
  }
}

export function writingPreview(text,{sectionLevel=2,scope}={}) {
  const result=h('div',{class:'prose formatted-writing'});
  function finish() {
    for (const link of result.querySelectorAll('a[href]')) {
      link.target = '_blank';
      link.rel = 'noopener';
      link.addEventListener('click',event=>{
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.isContentEditable) return;
        const tab = window.open('about:blank','_blank');
        if (!tab) return;
        event.preventDefault();
        tab.opener = null;
        tab.location.replace(link.href);
        tab.focus();
      });
    }
    return result;
  }
  if (String(text || '').startsWith(richPrefix)) {
    result.append(richFragment(text.slice(richPrefix.length), sectionLevel));
    showPhotos(result,scope);
    return finish();
  }
  let paragraph=[],list=null,hasSection=false;
  const flush=()=>{
    if(paragraph.length)result.append(h('p',null,inline(paragraph.join(' '))));
    paragraph=[];list=null;
  };
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.trim();
    const heading=line.match(/^(##|###)\s+(.+)$/);
    const item=line.match(/^(-|\d+\.)\s+(.+)$/);
    if(!line){flush();continue;}
    if(heading){
      flush();
      const nested=heading[1]==='###'&&hasSection;
      result.append(h('h'+(sectionLevel+Number(nested)),null,inline(heading[2])));
      hasSection=true;
    }else if(item){
      const tag=item[1]==='-'?'ul':'ol';
      if(list?.localName!==tag){flush();list=h(tag);result.append(list);}
      list.append(h('li',null,inline(item[2])));
    }else{
      list=null;paragraph.push(line);
    }
  }
  flush();
  return finish();
}

export function mountWritingEditor(control, {readOnly = false, scope, pickImage} = {}) {
  const id = control.id;
  const editor = h('div', {
    id, class:'rich-writing-area', contenteditable: String(!readOnly),
    role:'textbox', 'aria-multiline':'true', 'aria-labelledby':id+'-label',
    'aria-describedby':control.getAttribute('aria-describedby'),
    'aria-readonly':String(readOnly), tabindex:0
  });
  if (control.value.startsWith(richPrefix)) editor.append(richFragment(control.value.slice(richPrefix.length)));
  else editor.append(...writingPreview(control.value).childNodes);
  showPhotos(editor,scope,readOnly ? null : removePhoto);
  const field = control.closest('.field');
  field.querySelector('label').id = id+'-label';
  control.removeAttribute('id');
  control.hidden = true;
  const toolbar = h('div', {class:'writing-toolbar', role:'group', 'aria-label':'Writing formatting', hidden:readOnly});
  control.before(h('div',{class:'rich-writing-editor'},toolbar,editor));
  if (readOnly) return;

  let range;
  function rememberSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      range = selection.getRangeAt(0).cloneRange();
      const start = range.startContainer;
      const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
      styles.value = element.closest('h2,h3')?.localName || 'p';
    }
  }
  function sync() {
    const clean = document.createElement('div');
    clean.append(richFragment(editor.innerHTML));
    control.value = clean.textContent.trim() || clean.querySelector('figure') ? richPrefix+clean.innerHTML : '';
    control.dispatchEvent(new Event('input',{bubbles:true}));
    rememberSelection();
  }
  function removePhoto(figure) {
    figure.remove();
    editor.focus();
    sync();
  }
  function restoreSelection() {
    editor.focus();
    if (range && editor.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function command(name, value = null) {
    restoreSelection();
    document.execCommand(name, false, value);
    sync();
  }
  for (const event of ['keyup','pointerup','blur']) editor.addEventListener(event,rememberSelection);
  editor.addEventListener('input',sync);
  editor.addEventListener('paste',event=>{
    event.preventDefault();
    command('insertText',event.clipboardData.getData('text/plain'));
  });
  editor.addEventListener('drop',event=>event.preventDefault());
  toolbar.addEventListener('pointerdown',rememberSelection,true);

  const styles = h('select',{'aria-label':'Paragraph style',on:{change:event=>command('formatBlock',event.target.value)}},
    h('option',{value:'p'},'Normal'),
    h('option',{value:'h2'},'Heading'),
    h('option',{value:'h3'},'Subheading'));
  toolbar.append(styles);
  function tool(label, symbol, action, className = '') {
    const item = button(symbol,{'aria-label':label,title:label,class:className,onClick:action});
    item.addEventListener('mousedown',event=>event.preventDefault());
    toolbar.append(item);
  }
  for (const [label,symbol,name,className] of [
    ['Bold','B','bold','writing-bold'], ['Italic','I','italic','writing-italic'],
    ['Underline','U','underline','writing-underline'], ['Strikethrough','S','strikeThrough','writing-strike'],
    ['Numbered list','≡','insertOrderedList','writing-numbered'], ['Bulleted list','☷','insertUnorderedList','writing-bullets']
  ]) tool(label,symbol,()=>command(name),className);
  tool('Link','↗',async()=>{
    const selected = range?.cloneRange();
    if (!selected || !editor.contains(selected.commonAncestorContainer) || !selected.toString().trim()) {
      await messageDialog({title:'Select text first',body:'Highlight the words you want to turn into a link, then choose Link.'});
      return;
    }
    const start = selected.startContainer;
    const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
    const existing = element.closest('a');
    const url = h('input',{class:'input',type:'url',required:true,value:existing?.getAttribute('href') || '',
      placeholder:'https://example.com',on:{input:()=>url.setCustomValidity('')}});
    const form = h('form',null,h('label',{class:'field'},'Link URL',url));
    function apply(close) {
      const address = url.value.trim();
      url.setCustomValidity(httpsLink(address) ? '' : 'Enter a valid HTTPS address.');
      if (url.reportValidity()) close(address);
    }
    const dialog = openDialog({title:'Link selected text',content:form,actions:[
      {label:'Cancel'},{label:'Apply link',variant:'primary',onClick:apply}
    ]});
    form.addEventListener('submit',event=>{event.preventDefault();apply(dialog.close);});
    url.focus();
    const address = await dialog.result;
    if (!address || !editor.isConnected || !editor.contains(selected.commonAncestorContainer) || selected.collapsed) return;
    range = selected;
    command('createLink',address);
  });
  tool('Block quote','❞',()=>command('formatBlock','blockquote'));
  for (const [label,name,className] of [
    ['Text colour','foreColor','writing-foreground'],
    ['Highlight colour','hiliteColor','writing-highlight']
  ]) {
    const input = h('input',{type:'color',value:name==='foreColor'?'#222222':'#f8df83',
      'aria-label':label,title:label,on:{change:event=>command(name,event.target.value)}});
    toolbar.append(h('label',{class:'writing-colour '+className,title:label},'A',input));
  }
  if (pickImage) tool('Insert photo','Photo',async()=>{
    const [asset] = await pickImage({title:'Choose an inline photo'}) || [];
    if (!asset || !editor.isConnected) return;
    const alt = h('input',{class:'input',type:'text',value:asset.alt||'',maxLength:500,required:true});
    const caption = h('input',{class:'input',type:'text',maxLength:500});
    const fields = h('div',null,h('label',{class:'field'},'Alt text',alt),
      h('label',{class:'field'},'Caption (optional)',caption));
    const placement = await openDialog({title:'Describe this photo',content:fields,actions:[
      {label:'Cancel'},
      {label:'Insert photo',variant:'primary',onClick:close=>{
        alt.setCustomValidity(alt.value.trim() ? '' : 'Describe what the photo shows.');
        if (alt.reportValidity()) close({alt:alt.value.trim(),caption:caption.value.trim()});
      }}
    ]}).result;
    if (!placement || !editor.isConnected) return;
    const figure = h('figure',{'data-asset-id':asset.id,'data-alt':placement.alt},
      placement.caption ? h('figcaption',null,placement.caption) : null);
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return;
    selection.collapseToEnd();
    document.execCommand('insertParagraph');
    const anchor = selection.anchorNode;
    let block = anchor;
    while (block && block !== editor && block.parentNode !== editor) block = block.parentNode;
    if (block === editor) editor.insertBefore(figure,editor.childNodes[selection.anchorOffset] || null);
    else editor.insertBefore(figure,block || null);
    showPhotos(editor,scope,removePhoto);
    sync();
  });
  tool('Clear formatting','Tₓ',()=>{
    command('removeFormat');
    command('unlink');
    const tag = String(document.queryCommandValue('formatBlock')).toLowerCase();
    if (['h2','h3','blockquote'].includes(tag)) command('formatBlock','p');
    for (const list of ['insertOrderedList','insertUnorderedList']) {
      if (document.queryCommandState(list)) command(list);
    }
  });
}
