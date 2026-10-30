# Samaran Proxy with LiteLLM

Put Samaran Proxy **in front of** LiteLLM:

```text
app ──► Samaran Proxy :8787 ──► LiteLLM :4000 ──► OpenAI, Anthropic, Gemini, Bedrock, …
        masks, restores           sees only placeholders
```

LiteLLM keeps spend logs and sends requests to callbacks such as Langfuse. In this order they hold `[NIK_1]`, never the NIK. The proxy restores the real values in the answer before it reaches the app.

## Run it

1. Run LiteLLM as its documentation describes, with your `config.yaml` (an example is below), on `127.0.0.1:4000`.
2. Start the proxy with LiteLLM as its OpenAI-compatible upstream:

   ```sh
   npx @lokal-id/mcp proxy --openai http://127.0.0.1:4000
   ```

3. Point the app at the proxy, with a LiteLLM key. The proxy passes the key through to LiteLLM.

   ```python
   from openai import OpenAI
   client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-litellm-virtual-key")
   client.chat.completions.create(model="claude-sonnet", messages=[...])  # any model in LiteLLM's model_list
   ```

Every model in LiteLLM's `model_list` is reachable through the proxy in the OpenAI format, whichever provider is behind it.

## Example LiteLLM config

```yaml
# config.yaml for LiteLLM: the provider keys stay with LiteLLM.
model_list:
  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-5-5
      api_key: os.environ/ANTHROPIC_API_KEY
```

## Policy and local models

`.samaran.json` in the folder the proxy starts in applies as usual. A request with a `route` type goes straight to the local endpoint in `route`, past LiteLLM. To keep those requests in LiteLLM too, point `route.openai` at LiteLLM and choose a local model in `route.model` (an Ollama model in LiteLLM's `model_list`).

## Pin LiteLLM

LiteLLM was hit by supply-chain attacks twice in 2026: malicious 1.82.7 and 1.82.8 releases in March, and a 1.107.0 release on PyPI and Docker Hub in October, which also went out under the `latest`, `main-latest`, and `main-stable` image tags for a few hours ([LiteLLM's March advisory](https://docs.litellm.ai/blog/security-update-march-2026), [Help Net Security on October](https://www.helpnetsecurity.com/2026/10/22/litellm-compromised-supply-chain-attack-pypi-docker/)). Pin an exact version that LiteLLM's advisories list as clean, by image digest or package hash, never a moving tag. The proxy holds no provider key in this setup, but LiteLLM does.
