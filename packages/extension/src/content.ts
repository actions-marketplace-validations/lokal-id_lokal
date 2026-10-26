// Content script for AI chat sites. It masks personal data when it is pasted or about to be sent, and lets the user
// see and copy the real values. Real values are never written into the site's page: the site's own scripts
// (analytics, session replay) could read them there. Placeholders stay in the page, highlighted; the value shows in a
// tooltip inside a closed shadow root, and copying puts the real values on the clipboard.
import { detectPii } from '../../core/src/samaran/detectors.ts';
import { attachmentKind, maskedFiles, readAttachment } from './attachments.ts';
import {
  findPlaceholders,
  describe,
  hasKnownPlaceholder,
  pickLang,
  restore,
  restoreHtml,
  TEXT,
  type MaskResponse,
  type Request,
} from './shared.ts';

const lang = pickLang(navigator.language);
const t = TEXT[lang];
let vault = new Map<string, string>();
let enabled = true;
/** Events this script dispatched itself, so its own listeners let them through. */
const ours = new WeakSet<Event>();
let lastComposer: HTMLElement | undefined;

function send<T>(request: Request): Promise<T> {
  return chrome.runtime.sendMessage<T & { error?: string }>(request).then((response) => {
    if (response && typeof response === 'object' && 'error' in response && response.error) throw new Error(response.error);
    return response;
  });
}

// --- settings and vault ----------------------------------------------------------------------------------------

function applySettings(disabled: unknown): void {
  enabled = !(Array.isArray(disabled) && disabled.includes(location.hostname));
  if (!enabled) highlight.clear();
  else scheduleRefresh();
}

chrome.storage.local.get('disabled').then(({ disabled }) => applySettings(disabled));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.disabled) applySettings(changes.disabled.newValue);
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'vault' && Array.isArray(message.vault)) {
    vault = new Map(message.vault);
    scheduleRefresh();
  }
});
send<Array<[string, string]>>({ type: 'vault' })
  .then((entries) => {
    vault = new Map(entries);
    scheduleRefresh();
  })
  .catch(() => {});

// --- our UI: toasts and the tooltip, in a closed shadow root the page cannot read ------------------------------

const host = document.createElement('lokal-ui');
const shadow = host.attachShadow({ mode: 'closed' });
shadow.innerHTML = `<style>
:host{all:initial}
.toast,.tip{position:fixed;z-index:2147483647;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#111827;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.toast{right:16px;bottom:16px;max-width:360px;padding:10px 14px 10px 12px;display:flex;gap:10px;align-items:flex-start;opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;pointer-events:none}
.toast.on{opacity:1;transform:none}
.mark{flex:none;width:18px;height:18px;border-radius:5px;background:#E5262E;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center}
.tip{padding:6px 10px;pointer-events:none;display:none;max-width:420px;overflow-wrap:anywhere}
.tip small{display:block;color:#9ca3af;font-size:11px;margin-bottom:2px;word-break:normal}
.tip b{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600}
@media (prefers-reduced-motion:reduce){.toast{transition:none}}
</style><div class="toast" role="status" aria-live="polite"><span class="mark">L</span><span class="msg"></span></div><div class="tip"><small></small><b></b></div>`;
const toastEl = shadow.querySelector<HTMLElement>('.toast')!;
const tipEl = shadow.querySelector<HTMLElement>('.tip')!;
tipEl.querySelector('small')!.textContent = t.reveal;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function mountUi(): void {
  if (!host.isConnected) document.documentElement.append(host);
}

function toast(message: string): void {
  mountUi();
  toastEl.querySelector('.msg')!.textContent = message;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 5000);
}

// --- editors ---------------------------------------------------------------------------------------------------

/** The text box an event happened in: a textarea, a text input, or the outermost contenteditable element. */
function editableRoot(node: EventTarget | Node | null): HTMLElement | undefined {
  let el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (!el) return undefined;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement) return /^(?:text|search|)$/.test(el.type) ? el : undefined;
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return undefined;
  while (el.parentElement?.isContentEditable) el = el.parentElement;
  return el as HTMLElement;
}

function textOf(root: HTMLElement): string {
  return root instanceof HTMLTextAreaElement || root instanceof HTMLInputElement ? root.value : root.innerText;
}

/**
 * Inserts text the way a paste would, so the site's editor (ProseMirror, Quill, a React textarea) handles it like any
 * paste, long-paste attachments included. Falls back to insertText when nothing handles the paste.
 */
function insert(target: Node, root: HTMLElement, text: string): void {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true });
  ours.add(event);
  (target.isConnected ? target : root).dispatchEvent(event);
  if (!event.defaultPrevented) {
    root.focus();
    document.execCommand('insertText', false, text);
  }
}

function selectAll(root: HTMLElement): void {
  root.focus();
  if (root instanceof HTMLTextAreaElement || root instanceof HTMLInputElement) root.select();
  else getSelection()?.selectAllChildren(root);
}

/**
 * Editors such as ProseMirror (ChatGPT) read a new selection when selectionchange fires, after the current task. A
 * paste sent right after selecting everything lands at the old cursor and adds the text instead of replacing it.
 */
function selectionRead(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('selectionchange', finish);
      setTimeout(resolve, 20);
    };
    document.addEventListener('selectionchange', finish);
    setTimeout(finish, 100);
  });
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** Replaces everything in the box with `text`, and says whether the box now holds it. */
async function replaceAll(root: HTMLElement, text: string): Promise<boolean> {
  selectAll(root);
  if (!(root instanceof HTMLTextAreaElement || root instanceof HTMLInputElement)) await selectionRead();
  insert(root, root, text);
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (sameText(textOf(root), text)) return true;
  // The editor kept something: empty it the way a user would, then insert again.
  selectAll(root);
  await selectionRead();
  document.execCommand('delete');
  await selectionRead();
  insert(root, root, text);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return sameText(textOf(root), text);
}

const containsPii = (text: string) => detectPii(text).length > 0;

// Pasting: mask before the site sees the text. Clipboard contents without personal data are left alone, rich text
// and files included.
window.addEventListener(
  'paste',
  (event) => {
    if (!enabled || ours.has(event)) return;
    const root = editableRoot(event.target);
    const text = event.clipboardData?.getData('text/plain');
    // A file copied in the file manager arrives as a file without text.
    if (!text && event.clipboardData && holdFiles(event, event.clipboardData.files)) return;
    if (!root || !text || !containsPii(text)) return;
    // Hold the paste now; masking happens in the service worker.
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.target as Node;
    send<MaskResponse>({ type: 'mask', text })
      .then((result) => {
        vault = new Map(result.vault);
        insert(target, root, result.text);
        if (result.types.length) toast(t.masked(describe(result.types, lang)));
      })
      .catch(() => toast(t.failed));
  },
  true,
);

// --- attachments -----------------------------------------------------------------------------------------------

// Files chosen with the site's file picker, dropped on the page, or pasted are held until they are checked. A file
// with personal data is replaced by a masked copy; one without is let through unchanged, formatting and all. Images
// and other files Lokal cannot read pass at once.

const fileList = (files: Iterable<File>) => {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  return data;
};

async function maskFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  const types: MaskResponse['types'] = [];
  const changed: string[] = [];
  const notes: string[] = [];
  let converted = false;
  if (files.some((f) => f.size > 1024 * 1024)) toast(t.checkingFiles);
  for (const file of files) {
    const read = readAttachment(file.name, new Uint8Array(await file.arrayBuffer()), file.type);
    if (!read) {
      out.push(file);
      continue;
    }
    if ('reason' in read) {
      notes.push(t.unreadableFile(file.name, t.why[read.reason]));
      out.push(file);
      continue;
    }
    const masked: string[] = [];
    let found = 0;
    for (const part of read.parts) {
      const result = await send<MaskResponse>({ type: 'mask', text: part.csv });
      vault = new Map(result.vault);
      masked.push(result.text);
      types.push(...result.types);
      found += result.types.length;
    }
    if (!found) {
      out.push(file);
      continue;
    }
    changed.push(file.name);
    for (const m of maskedFiles(file.name, file.type, read, masked)) {
      out.push(new File([m.text], m.name, { type: m.type, lastModified: file.lastModified }));
      if (m.name !== file.name) converted = true;
    }
    if (read.scannedPages) notes.push(t.scannedPages(read.scannedPages.join(', ')));
  }
  const messages = [];
  if (types.length) messages.push(t.maskedFiles(describe(types, lang), changed.join(', ')));
  if (converted) messages.push(t.convertedFiles);
  messages.push(...notes);
  if (messages.length) toast(messages.join(' '));
  return out;
}

/**
 * Holds an event that carries files Lokal can read, and dispatches it again once they are checked. `redispatch` gets
 * the files to use instead. Returns whether the event was held.
 */
function holdFiles(event: Event, files: FileList | null | undefined, redispatch?: (files: File[]) => void): boolean {
  const list = [...(files ?? [])];
  if (!list.some((f) => attachmentKind(f.name, f.type))) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = event.target as EventTarget;
  maskFiles(list).then(
    (checked) => {
      if (redispatch) return redispatch(checked);
      const again = new ClipboardEvent('paste', { clipboardData: fileList(checked), bubbles: true, cancelable: true, composed: true });
      ours.add(again);
      target.dispatchEvent(again);
    },
    () => toast(t.fileFailed),
  );
  return true;
}

// The site's file picker. Its input event comes first and is held with the change event; both are sent again.
for (const type of ['input', 'change'] as const) {
  window.addEventListener(
    type,
    (event) => {
      if (!enabled || ours.has(event)) return;
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      if (type === 'input') {
        if ([...input.files].some((f) => attachmentKind(f.name, f.type))) event.stopImmediatePropagation();
        return;
      }
      holdFiles(event, input.files, (checked) => {
        input.files = fileList(checked).files;
        for (const name of ['input', 'change']) {
          const again = new Event(name, { bubbles: true });
          ours.add(again);
          input.dispatchEvent(again);
        }
      });
    },
    true,
  );
}

window.addEventListener(
  'drop',
  (event) => {
    if (!enabled || ours.has(event)) return;
    const { clientX, clientY, screenX, screenY, ctrlKey, shiftKey, altKey, metaKey } = event;
    const target = event.target as EventTarget;
    holdFiles(event, event.dataTransfer?.files, (checked) => {
      const again = new DragEvent('drop', {
        dataTransfer: fileList(checked),
        bubbles: true,
        cancelable: true,
        composed: true,
        ...{ clientX, clientY, screenX, screenY, ctrlKey, shiftKey, altKey, metaKey },
      });
      ours.add(again);
      target.dispatchEvent(again);
    });
  },
  true,
);

// Typing: before a message goes out, by Enter or by a send button, mask what was typed and let the user look first.
function guardSend(root: HTMLElement, event: Event): boolean {
  const text = textOf(root);
  if (!text.trim() || !containsPii(text)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  send<MaskResponse>({ type: 'mask', text })
    .then(async (result) => {
      vault = new Map(result.vault);
      // Still held either way: a message with personal data in it is never sent by this Enter.
      if (await replaceAll(root, result.text)) toast(t.maskedOnSend(describe(result.types, lang)));
      else toast(t.replaceFailed);
    })
    .catch(() => toast(t.failed));
  return true;
}

window.addEventListener('focusin', (event) => {
  const root = editableRoot(event.target);
  if (root) lastComposer = root;
});

window.addEventListener(
  'keydown',
  (event) => {
    if (!enabled || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const root = editableRoot(event.target);
    if (root && !(root instanceof HTMLInputElement && root.type === 'search')) guardSend(root, event);
  },
  true,
);

const SEND_LABEL = /\b(?:send|submit|kirim)\b|send-button|composer-submit/i;

for (const type of ['pointerdown', 'click'] as const) {
  window.addEventListener(
    type,
    (event) => {
      if (!enabled || !lastComposer?.isConnected) return;
      const button = (event.target as Element | null)?.closest?.('button, [role="button"]');
      if (!button) return;
      const label = `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('data-testid') ?? ''} ${button.getAttribute('title') ?? ''}`;
      if (SEND_LABEL.test(label)) guardSend(lastComposer, event);
    },
    true,
  );
}

// --- copying ---------------------------------------------------------------------------------------------------

function selectedText(): { text: string; html?: string } | undefined {
  // A text box that still has focus only counts when text inside it is selected: a selection in the reply wins.
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const { selectionStart: start, selectionEnd: end } = active;
    if (start !== null && end !== null && start !== end) return { text: active.value.slice(start, end) };
  }
  const selection = getSelection();
  if (!selection || selection.isCollapsed) return undefined;
  const box = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) box.append(selection.getRangeAt(i).cloneContents());
  return { text: selection.toString(), html: box.innerHTML };
}

// Ctrl+C and the context menu: the clipboard gets the real values.
window.addEventListener(
  'copy',
  (event) => {
    if (!enabled || !vault.size || !event.clipboardData) return;
    const selected = selectedText();
    if (!selected || !hasKnownPlaceholder(selected.text, vault)) return;
    event.clipboardData.setData('text/plain', restore(selected.text, vault));
    if (selected.html) event.clipboardData.setData('text/html', restoreHtml(selected.html, vault));
    event.preventDefault();
    toast(t.copied);
  },
  true,
);

// The site's own copy buttons write with navigator.clipboard in the page; page-clipboard.ts reports what they wrote
// (placeholders only), and the clipboard is written again here with the real values.
window.addEventListener('lokal:clipboard', (event) => {
  if (!enabled || !vault.size) return;
  let written: { text?: string; html?: string };
  try {
    written = JSON.parse(String((event as CustomEvent).detail));
  } catch {
    return;
  }
  const text = typeof written.text === 'string' ? written.text : '';
  const html = typeof written.html === 'string' ? written.html : '';
  if (!hasKnownPlaceholder(text, vault) && !hasKnownPlaceholder(html, vault)) return;
  const items: Record<string, Blob> = { 'text/plain': new Blob([restore(text, vault)], { type: 'text/plain' }) };
  if (html) items['text/html'] = new Blob([restoreHtml(html, vault)], { type: 'text/html' });
  navigator.clipboard
    .write([new ClipboardItem(items)])
    .catch(() => navigator.clipboard.writeText(restore(text, vault)))
    .then(() => toast(t.copied), () => {});
});

// --- highlighting placeholders and showing their values --------------------------------------------------------

const highlight = new Highlight();
CSS.highlights.set('lokal-pii', highlight);
let ranges: Array<{ range: Range; placeholder: string }> = [];

const style = document.createElement('style');
style.textContent = '::highlight(lokal-pii){background-color:rgba(229,38,46,.16);text-decoration:underline dotted #E5262E;}';

function refresh(): void {
  highlight.clear();
  ranges = [];
  if (!enabled || !vault.size || !document.body) return;
  if (!style.isConnected) (document.head ?? document.documentElement).append(style);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    if (!data.includes('[')) continue;
    for (const [start, end, placeholder] of findPlaceholders(data, vault)) {
      const range = new Range();
      range.setStart(node, start);
      range.setEnd(node, end);
      highlight.add(range);
      ranges.push({ range, placeholder });
    }
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
}

new MutationObserver(scheduleRefresh).observe(document, { childList: true, subtree: true, characterData: true });

function placeholderAt(x: number, y: number): { range: Range; placeholder: string } | undefined {
  for (const entry of ranges) {
    if (!entry.range.startContainer.isConnected) continue;
    for (const rect of entry.range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return entry;
    }
  }
  return undefined;
}

let pointer: { x: number; y: number } | undefined;
let frame = 0;
window.addEventListener(
  'mousemove',
  (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (frame || !ranges.length) {
      if (!ranges.length) tipEl.style.display = 'none';
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      const hit = pointer && placeholderAt(pointer.x, pointer.y);
      const value = hit && vault.get(hit.placeholder);
      if (!hit || value === undefined) {
        tipEl.style.display = 'none';
        return;
      }
      mountUi();
      tipEl.querySelector('b')!.textContent = value;
      const rect = hit.range.getBoundingClientRect();
      tipEl.style.display = 'block';
      const top = rect.top - tipEl.offsetHeight - 6;
      tipEl.style.top = `${top < 4 ? rect.bottom + 6 : top}px`;
      tipEl.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - tipEl.offsetWidth - 4))}px`;
    });
  },
  { passive: true },
);
window.addEventListener('scroll', () => (tipEl.style.display = 'none'), { passive: true, capture: true });
