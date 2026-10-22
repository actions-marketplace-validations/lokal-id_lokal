// The AI chat sites the extension runs on. scripts/build-extension.mjs writes these into manifest.json, and the
// popup uses them to say whether the current tab is covered.
export const SITES: ReadonlyArray<{ name: string; hosts: readonly string[] }> = [
  { name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { name: 'Claude', hosts: ['claude.ai'] },
  { name: 'Gemini', hosts: ['gemini.google.com', 'aistudio.google.com'] },
  { name: 'Microsoft Copilot', hosts: ['copilot.microsoft.com'] },
  { name: 'Perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'] },
  { name: 'DeepSeek', hosts: ['chat.deepseek.com'] },
  { name: 'Grok', hosts: ['grok.com'] },
  { name: 'Le Chat', hosts: ['chat.mistral.ai'] },
];

export const MATCHES = SITES.flatMap((site) => site.hosts.map((host) => `https://${host}/*`));
