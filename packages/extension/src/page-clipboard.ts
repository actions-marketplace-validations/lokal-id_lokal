// Runs in the page itself (world: MAIN), because a site's copy button writes with the page's navigator.clipboard,
// which the content script cannot see. After each write it reports what was written: the page's own text, with
// placeholders only. The content script then writes the clipboard again with the real values. No real value ever
// reaches this script.
(() => {
  const clipboard = navigator.clipboard;
  if (!clipboard) return;
  const report = (text: string, html?: string) =>
    window.dispatchEvent(new CustomEvent('lokal:clipboard', { detail: JSON.stringify({ text, html }) }));

  const writeText = clipboard.writeText.bind(clipboard);
  clipboard.writeText = async function (text: string) {
    await writeText(text);
    report(String(text));
  };

  const write = clipboard.write.bind(clipboard);
  clipboard.write = async function (items: ClipboardItems) {
    await write(items);
    try {
      const read = async (type: string) => {
        const item = [...items].find((i) => i.types.includes(type));
        return item ? (await item.getType(type)).text() : undefined;
      };
      const text = await read('text/plain');
      if (text !== undefined) report(text, await read('text/html'));
    } catch {
      // Nothing to report; the site's copy already happened.
    }
  };
})();
