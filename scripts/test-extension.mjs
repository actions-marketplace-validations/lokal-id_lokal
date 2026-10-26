// End-to-end test of the browser extension: loads packages/extension/dist-test into a real Chromium browser (Edge or
// Chrome, with a throwaway profile) and drives a local page that behaves like an AI chat: a contenteditable editor
// with its own paste handler (like ProseMirror), a textarea, a send button, and a copy button that uses
// navigator.clipboard. The data is made up.
//
//   node scripts/build-extension.mjs --test && node scripts/test-extension.mjs [--browser <path>] [--headed]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'packages/extension/dist-test');
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const CANDIDATES = [
  process.argv.includes('--browser') && arg('--browser'),
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => existsSync(p));
if (!BROWSER) throw new Error('No Chromium browser found; pass --browser <path>.');
if (!existsSync(path.join(EXT, 'manifest.json'))) throw new Error('Run node scripts/build-extension.mjs --test first.');

const NIK = '3201011508950001';
const PHONE = '0812-3456-7890';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>chat</title>
<style>body{font:16px system-ui;margin:24px;width:720px}#editor,#plain{border:1px solid #999;min-height:40px;padding:8px;margin:8px 0;width:100%}</style></head><body>
<div id="reply"></div>
<div id="editor" contenteditable="true"></div>
<textarea id="plain"></textarea>
<button id="send" aria-label="Send message">Kirim</button>
<button id="copy" aria-label="Copy">Copy</button>
<input type="file" id="file" multiple>
<div id="drop" style="height:60px;border:1px dashed #999">drop</div>
<script>
window.uploads = [];
// Like a chat's attach button and drop zone: they read whatever files reach them.
const take = async (files, via) => {
  for (const f of files) window.uploads.push({ via, name: f.name, type: f.type, text: f.type.startsWith('image/') ? '(image)' : await f.text() });
};
file.addEventListener('change', () => take(file.files, 'picker'));
drop.addEventListener('dragover', (e) => e.preventDefault());
drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files, 'drop'); });
window.sent = [];
window.pastes = [];
// Like ProseMirror: the editor handles paste itself, from the event's clipboardData.
editor.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text/plain');
  window.pastes.push(text);
  e.preventDefault();
  const sel = getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (range && editor.contains(range.startContainer)) {
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    sel.collapseToEnd();
  } else {
    editor.textContent += text;
  }
});
const submit = (box) => { window.sent.push(box.value ?? box.innerText); };
plain.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(plain); } });
send.addEventListener('click', () => submit(document.activeElement === plain ? plain : editor));
copy.addEventListener('click', () => navigator.clipboard.writeText(reply.innerText));
</script></body></html>`;

// --- a minimal CDP client --------------------------------------------------------------------------------------

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return { ready, send, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

// --- run -------------------------------------------------------------------------------------------------------

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(path.join(tmpdir(), 'lokal-ext-'));
const port = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(
  BROWSER,
  [
    ...(process.argv.includes('--headed') ? [] : ['--headless=new']),
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=900,700',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let client;
let files;
let failed = false;
try {
  const version = await until(
    () => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => undefined),
    'the browser',
    20000,
  );
  client = cdp(version.webSocketDebuggerUrl);
  await client.ready;
  const { send } = client;

  const worker = await until(async () => {
    const { targetInfos } = await send('Target.getTargets');
    return targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
  }, 'the extension service worker (is --load-extension allowed in this browser?)', 15000);
  console.log(`extension loaded: ${worker.url.split('/')[2]} in ${path.basename(BROWSER)}`);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page('Page.enable');
  await page('Runtime.enable');
  await send('Browser.grantPermissions', { origin: pageUrl.slice(0, -1), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await page('Page.navigate', { url: pageUrl });
  await sleep(800);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const key = async (keyName, code = keyName, extra = {}) => {
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyName === 'Enter' ? 13 : 0, ...extra });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyName === 'Enter' ? 13 : 0 });
  };
  const pasteInto = (selector, text) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus();
      const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)});
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failed = true;
      console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`);
    }
  };

  await check('a paste with personal data reaches the editor masked, through its own paste handler', async () => {
    await pasteInto('#editor', `Nama: Budi Santoso, NIK ${NIK}, HP ${PHONE}`);
    const text = await until(() => evaluate('editor.innerText.includes("[NIK_") && editor.innerText'), 'masked text');
    assert.equal(text, 'Nama: [NAME_1], NIK [NIK_1], HP [PHONE_1]');
    const pastes = await evaluate('window.pastes');
    assert.deepEqual(pastes, ['Nama: [NAME_1], NIK [NIK_1], HP [PHONE_1]'], 'the site saw only the masked paste');
  });

  await check('a paste without personal data is left alone', async () => {
    await evaluate('editor.textContent = ""; window.pastes = []');
    await pasteInto('#editor', 'tolong rapikan kode ini');
    assert.deepEqual(await evaluate('window.pastes'), ['tolong rapikan kode ini']);
  });

  await check('typed data is masked before Enter sends it, and the second Enter sends', async () => {
    await evaluate('plain.focus(); plain.value = ""');
    await page('Input.insertText', { text: `cek NIK ${NIK} ya` });
    await key('Enter');
    await until(() => evaluate('plain.value.includes("[NIK_1]")'), 'masked textarea');
    assert.deepEqual(await evaluate('window.sent'), [], 'nothing was sent with the real NIK');
    assert.equal(await evaluate('plain.value'), 'cek NIK [NIK_1] ya', 'the same NIK keeps its placeholder');
    await key('Enter');
    assert.deepEqual(await evaluate('window.sent'), ['cek NIK [NIK_1] ya']);
  });

  await check('a send button is held the same way', async () => {
    await evaluate('window.sent = []; plain.focus(); plain.value = ""');
    await page('Input.insertText', { text: 'rekening 1234567890 a.n. Siti Aminah' });
    await evaluate('send.click()');
    await until(() => evaluate('!plain.value.includes("1234567890") && plain.value'), 'masked textarea');
    assert.deepEqual(await evaluate('window.sent'), []);
  });

  await check('real values never appear in the page; placeholders are highlighted', async () => {
    await evaluate(`reply.textContent = 'Baik, data [NAME_1] dengan NIK [NIK_1] sudah dicek. Hubungi [PHONE_1].'`);
    await until(() => evaluate('(CSS.highlights.get("lokal-pii")?.size ?? 0) >= 3'), 'highlights');
    const html = await evaluate('document.documentElement.outerHTML + document.body.innerText');
    for (const secret of [NIK, PHONE, 'Budi Santoso']) assert.ok(!html.includes(secret), `${secret} is not in the page`);
  });

  await check('hovering a placeholder shows its value (screenshot)', async () => {
    const box = await evaluate(`(() => { const r = new Range(); const t = reply.firstChild; const i = t.data.indexOf('[NIK_1]');
      r.setStart(t, i); r.setEnd(t, i + 7); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await sleep(300);
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    const out = path.join(tmpdir(), 'lokal-extension-hover.png');
    writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(`       screenshot: ${out}`);
  });

  await check('Ctrl+C copies the real values', async () => {
    await evaluate('getSelection().selectAllChildren(reply)');
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', modifiers: 2, commands: ['copy'] });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2 });
    const text = await until(async () => {
      const t = await evaluate('navigator.clipboard.readText()');
      return t.includes(NIK) && t;
    }, 'clipboard with the real NIK');
    assert.equal(text, `Baik, data Budi Santoso dengan NIK ${NIK} sudah dicek. Hubungi ${PHONE}.`);
  });

  await check("the site's copy button (navigator.clipboard.writeText) gets the real values too", async () => {
    await evaluate('navigator.clipboard.writeText("kosong")');
    await evaluate('copy.click()');
    const text = await until(async () => {
      const t = await evaluate('navigator.clipboard.readText()');
      return t.includes(NIK) && t;
    }, 'clipboard rewritten with the real NIK');
    assert.ok(text.includes('Budi Santoso'));
  });

  // Attachments, from files on disk the way a user picks them.
  files = mkdtempSync(path.join(tmpdir(), 'lokal-ext-files-'));
  const onDisk = (name, content) => {
    const p = path.join(files, name);
    writeFileSync(p, content);
    return p;
  };
  const csv = onDisk('ekspor.csv', `nama,nik,hp\nBudi Santoso,${NIK},${PHONE}\n`);
  const clean = onDisk('catatan.txt', 'rapat jam 10, bahas roadmap\n');
  const png = onDisk('foto.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  const xlsx = path.join(files, 'pelanggan.xlsx');
  copyFileSync(path.join(ROOT, 'packages/mcp/test/fixtures/pelanggan.xlsx'), xlsx);
  const pdf = path.join(files, 'surat-keterangan.pdf');
  copyFileSync(path.join(ROOT, 'packages/mcp/test/fixtures/surat-keterangan.pdf'), pdf);
  const fileInput = async () => (await page('Runtime.evaluate', { expression: 'document.querySelector("#file")' })).result.objectId;
  const uploads = (n) => until(async () => {
    const u = await evaluate('window.uploads');
    return u.length >= n && u;
  }, `${n} uploads`);

  await check('files picked with the file input reach the site masked; other files unchanged', async () => {
    await evaluate('window.uploads = []');
    await page('DOM.setFileInputFiles', { objectId: await fileInput(), files: [csv, xlsx, png, clean] });
    const got = await uploads(5);
    assert.deepEqual(got.map((u) => u.name), ['ekspor.csv', 'pelanggan - Pelanggan.csv', 'pelanggan - Medis.csv', 'foto.png', 'catatan.txt']);
    assert.equal(got[0].text, 'nama,nik,hp\n[NAME_1],[NIK_1],[PHONE_1]\n', 'the same NIK keeps its placeholder');
    const all = JSON.stringify(got);
    for (const secret of [NIK, 'Budi Santoso', 'Siti Aminah', '3276015508030002']) assert.ok(!all.includes(secret), `${secret} was not uploaded`);
    assert.equal(got[3].type, 'image/png');
    assert.equal(got[4].text, 'rapat jam 10, bahas roadmap\n', 'a file without personal data is left alone');
  });

  await check('a dropped PDF reaches the drop zone as masked text', async () => {
    await evaluate('window.uploads = []');
    const at = await evaluate('(() => { const b = drop.getBoundingClientRect(); return { x: b.left + 20, y: b.top + 20 }; })()');
    const data = { items: [], files: [pdf], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await page('Input.dispatchDragEvent', { type, ...at, data });
    const [got] = await uploads(1);
    assert.equal(got.via, 'drop');
    assert.equal(got.name, 'surat-keterangan.txt');
    assert.match(got.text, /^--- Halaman 1 ---\n/);
    assert.match(got.text, /\[(?:NAME|NIK)_\d+\]/);
  });

  await check('the same value gets the same placeholder in another tab', async () => {
    const second = await send('Target.createTarget', { url: pageUrl });
    const s2 = (await send('Target.attachToTarget', { targetId: second.targetId, flatten: true })).sessionId;
    await sleep(800);
    await send('Runtime.evaluate', {
      expression: `(() => { editor.focus(); const dt = new DataTransfer(); dt.setData('text/plain', 'NIK ${NIK} dan HP 0813-9876-5432');
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`,
    }, s2);
    const text = await until(async () => {
      const { result } = await send('Runtime.evaluate', { expression: 'editor.innerText', returnByValue: true }, s2);
      return result.value.includes('[NIK_') && result.value;
    }, 'masked text in the second tab');
    // The attachments above added more phone numbers to the vault; the NIK is the same one.
    assert.match(text, /^NIK \[NIK_1\] dan HP \[PHONE_\d+\]$/);
    assert.notEqual(text, 'NIK [NIK_1] dan HP [PHONE_1]', 'a new number gets a new placeholder');
  });
} finally {
  client?.close();
  browser.kill();
  if (files) rmSync(files, { recursive: true, force: true });
  server.close();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // The browser may still hold files on Windows; the folder is in the temp directory.
  }
}
if (failed) process.exitCode = 1;
else console.log('extension ok');
