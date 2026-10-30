# Samaran Proxy with a local model (Docker Compose)

```text
app ──► Samaran Proxy 127.0.0.1:8787 ──► OpenAI / Anthropic   personal data masked, restored in the answer
                     └──────────────────► Ollama (compose network)   health data and criminal records, as they are
```

- The proxy masks personal data in every request and restores it in the answer.
- A request with health data or a criminal record goes to Ollama instead, unmasked, and never to the cloud. That is the `policy` in [.samaran.json](.samaran.json); change it to suit.
- The proxy is published on `127.0.0.1` only, because it sees real data. Ollama is not published at all.
- The audit log, which holds counts and never values, is kept in the `audit` volume.

## Run it

```sh
docker compose up -d
docker compose exec ollama ollama pull llama3.2
```

Point the app at the proxy. API keys pass through to the provider; the proxy keeps nothing.

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1")  # OPENAI_API_KEY as usual
```

```sh
curl -s http://127.0.0.1:8787/v1/chat/completions -H "authorization: Bearer $OPENAI_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Pasien Kenanga Purbasari didiagnosa diabetes tipe 2. Buat ringkasan kontrol."}]}' -i | grep -i x-samaran
# x-samaran-routed: … the request went to Ollama
```

Read the audit log:

```sh
docker compose exec lokal-proxy lokal-mcp audit --since 24h
```

## Notes

- **Versions.** `Dockerfile` installs the `@lokal-id/mcp` release named in `LOKAL_VERSION`. The base images are pinned by digest. Update them on purpose, not on every build.
- **GPU.** Uncomment the `deploy` block in `compose.yaml` to give Ollama an NVIDIA GPU. A CPU works for small models, slowly.
- **Anthropic.** A routed request in the Anthropic format needs an Anthropic-compatible local endpoint in `route.anthropic`. Without one, the proxy refuses it rather than send it to the cloud.
- **LiteLLM.** See [../litellm](../litellm) to put the proxy in front of LiteLLM.
