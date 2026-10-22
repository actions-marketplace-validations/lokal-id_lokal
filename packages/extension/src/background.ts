// Service worker: the only place that masks, so every tab shares one vault and [NIK_1] means the same person in all
// of them. The vault lives in storage.session, which stays in memory and is gone when the browser closes; it is
// never written to disk or sent anywhere.
import { Samaran } from '../../core/src/samaran/index.ts';
import type { MaskResponse, Request, Stats } from './shared.ts';

let samaran: Samaran | undefined;
let masked = 0;
// One request at a time, so two tabs masking at once cannot hand out the same placeholder twice.
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Samaran> {
  if (samaran) return samaran;
  const fresh = new Samaran();
  const { vault, masked: count } = await chrome.storage.session.get(['vault', 'masked']);
  if (Array.isArray(vault)) fresh.importVault(vault);
  masked = typeof count === 'number' ? count : 0;
  samaran = fresh;
  return fresh;
}

async function broadcast(message: unknown): Promise<void> {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

async function handle(request: Request): Promise<unknown> {
  const s = await load();
  switch (request.type) {
    case 'mask': {
      const { text, matches } = s.mask(String(request.text));
      const vault = s.exportVault();
      if (matches.length) {
        masked += matches.length;
        await chrome.storage.session.set({ vault, masked });
        await chrome.action.setBadgeBackgroundColor({ color: '#E5262E' });
        await chrome.action.setBadgeText({ text: masked > 999 ? '999+' : String(masked) });
        void broadcast({ type: 'vault', vault });
      }
      return { text, types: matches.map((m) => m.type), vault } satisfies MaskResponse;
    }
    case 'vault':
      return s.exportVault();
    case 'stats':
      return { masked, known: s.size } satisfies Stats;
    case 'clear':
      samaran = new Samaran();
      masked = 0;
      await chrome.storage.session.clear();
      await chrome.action.setBadgeText({ text: '' });
      void broadcast({ type: 'vault', vault: [] });
      return true;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages and content scripts can reach the vault.
  if (sender.id !== chrome.runtime.id) return false;
  const next = queue.then(() => handle(message as Request));
  queue = next.catch(() => {});
  next.then(sendResponse, (e: Error) => sendResponse({ error: e.message }));
  return true;
});
