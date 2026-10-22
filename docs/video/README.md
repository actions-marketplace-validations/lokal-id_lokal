# Demo animations

The animations in the Lokal README are [Remotion](https://www.remotion.dev) compositions:

| Composition | Output | Shows |
|---|---|---|
| `AgentDemoEN`, `AgentDemoID` | `docs/assets/demo.gif`, `demo.id.gif` | An agent reading a customer CSV without Lokal and with it, and what the model provider receives |
| `ExtensionDemoEN`, `ExtensionDemoID` | `docs/assets/extension-demo.gif`, `extension-demo.id.gif` | The browser extension: paste, mask, answer, reveal, copy |

```sh
cd docs/video
npm ci --ignore-scripts
npm run studio    # preview and edit
npm run render    # GIFs to docs/assets, MP4s for posts to out/ (needs ffmpeg)
```

Every name, NIK, and phone number is made up. The masked text is what `@lokal-id/core` produces for the same input, and the extension's toast and tooltip strings are copied from `packages/extension/src/shared.ts`; keep them in step when those change. The chat page in the extension demo is a made-up "Asisten AI", not any real product.

Remotion is free for individuals and small teams; see its [license](https://www.remotion.dev/license).
