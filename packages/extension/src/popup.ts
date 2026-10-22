import { pickLang, restore, type Request, type Stats } from './shared.ts';
import { SITES } from './sites.ts';

const lang = pickLang(chrome.i18n.getUILanguage());
document.documentElement.lang = lang;

const COPY = {
  id: {
    tagline: 'Data pribadi tetap di browsermu',
    masked: 'nilai disamarkan',
    known: 'bisa dipulihkan',
    active: 'Menyamarkan NIK, nomor HP, rekening, nama, dan data UU PDP lain sebelum terkirim.',
    paused: 'Dijeda di situs ini. Data yang ditempel terkirim apa adanya.',
    unsupported: 'Lokal bekerja di ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, dan Le Chat.',
    restoreLabel: 'Pulihkan teks dengan placeholder seperti [NIK_1]:',
    restore: 'Pulihkan dan salin',
    restored: 'Disalin',
    clearHint: 'Data asli hanya disimpan di memori browser ini dan hilang saat browser ditutup.',
    clear: 'Lupakan semua data asli',
    cleared: 'Sudah dilupakan',
    footer: 'Open source, tanpa server, tanpa pelacakan',
  },
  en: {
    tagline: 'Personal data stays in your browser',
    masked: 'values masked',
    known: 'can be restored',
    active: 'Masks NIK, phone numbers, bank accounts, names, and other UU PDP data before it is sent.',
    paused: 'Paused on this site. Pasted data is sent as it is.',
    unsupported: 'Lokal works on ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok, and Le Chat.',
    restoreLabel: 'Restore text with placeholders like [NIK_1]:',
    restore: 'Restore and copy',
    restored: 'Copied',
    clearHint: 'Real values are kept only in this browser’s memory and are gone when it closes.',
    clear: 'Forget all real values',
    cleared: 'Forgotten',
    footer: 'Open source, no server, no tracking',
  },
}[lang];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = COPY[el.dataset.t as keyof typeof COPY] as string;

const send = <T>(request: Request) => chrome.runtime.sendMessage<T>(request);

async function showStats(): Promise<void> {
  const stats = await send<Stats>({ type: 'stats' });
  $('masked').textContent = String(stats.masked);
  $('known').textContent = String(stats.known);
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = '';
  try {
    hostname = new URL(tab?.url ?? '').hostname;
  } catch {
    // A tab without a URL we can read: chrome:// pages and the like.
  }
  const supported = SITES.some((site) => site.hosts.includes(hostname));
  const toggle = $<HTMLInputElement>('enabled');
  $('site').textContent = hostname || 'Lokal';
  if (!supported) {
    $('switch').hidden = true;
    $('site-hint').textContent = COPY.unsupported;
  } else {
    const { disabled = [] } = await chrome.storage.local.get('disabled');
    const list: string[] = Array.isArray(disabled) ? disabled : [];
    toggle.checked = !list.includes(hostname);
    toggle.setAttribute('aria-label', hostname);
    $('site-hint').textContent = toggle.checked ? COPY.active : COPY.paused;
    toggle.addEventListener('change', async () => {
      const next = toggle.checked ? list.filter((h) => h !== hostname) : [...new Set([...list, hostname])];
      list.splice(0, list.length, ...next);
      await chrome.storage.local.set({ disabled: next });
      $('site-hint').textContent = toggle.checked ? COPY.active : COPY.paused;
    });
  }
  await showStats();
}

$('restore').addEventListener('click', async () => {
  const vault = new Map(await send<Array<[string, string]>>({ type: 'vault' }));
  const input = $<HTMLTextAreaElement>('restore-in');
  input.value = restore(input.value, vault);
  await navigator.clipboard.writeText(input.value);
  const button = $('restore');
  button.textContent = COPY.restored;
  setTimeout(() => (button.textContent = COPY.restore), 1500);
});

$('clear').addEventListener('click', async () => {
  await send({ type: 'clear' });
  const button = $<HTMLButtonElement>('clear');
  button.textContent = COPY.cleared;
  button.disabled = true;
  $<HTMLTextAreaElement>('restore-in').value = '';
  await showStats();
});

void init();
