# Bring your own AI key

Connect an OpenAI or Anthropic API account to use your chosen model for README introductions, feature copy, and selected-text rewrites. The model receives repository evidence, the selected tone, and writing instructions; factual checks still protect technical instructions and reject unsupported claims.

## Connect a provider

1. Sign in using **Connect GitHub** at [README Roulette](https://readmeroulette.oddware.dev), or your local installation.
2. Open **Settings → Bring your own AI key**.
3. Choose **OpenAI** or **Anthropic** and paste a key issued by that provider's API console. A ChatGPT or Claude chat subscription is separate from API access.
4. Click **Check key & load models**, then select a model or enter its exact ID. OpenAI models must support the Responses API and JSON output; Anthropic models must support the Messages API. The list is discovered from your account, with obvious non-text OpenAI models excluded. Discovery confirms access, not every model capability; use a compatible model if generation reports a format error. You can enter an ID manually if it is absent from the list.
5. Click **Save AI settings**. Saving verifies model access without generating text. Return to a repository and click **Generate README**.

One provider/model/key is active per GitHub account. Change the model while leaving the key field blank to reuse the saved key. Enter a new key to replace it, or choose **Remove key** to delete it. Changing providers requires that provider's key. Signing out does not delete the saved connection.

The personal connection takes priority over the administrator's optional `AI_ENDPOINT` adapter. Without either, the local writer still works. The editor identifies the writer used for full README generation. Saving AI settings leaves your current draft unchanged.

## Generation and costs

Generation, tone changes that regenerate an existing draft, section regeneration, and selected-text rewrites use the saved provider. API usage is billed directly to your provider account, including unsuccessful copy that needs repair. Each action makes at most two generation requests: the first candidate and, if it fails validation, one repair attempt. Generation is capped at 8,000 output tokens per request; selection rewriting at 4,000. Provider pricing and model behavior determine the cost.

Invalid keys, missing model access, quota/rate limits, incomplete responses, and network errors display a message and leave the draft unchanged. Check the key, selected model, and provider billing before retrying. Copy that fails factual/editorial review after one repair uses the local fallback, explicitly reported in the editor. A key enables model writing; it does not guarantee that every candidate will pass review.

## Storage and privacy

- Keys are submitted over HTTPS to the application, encrypted with AES-256-GCM, and stored in `ai_credentials` in SQLite locally or Azure SQL in production. Each ciphertext is bound to its account and provider. Settings responses contain only the provider/model and whether a key is configured.
- The app does not save keys in browser storage, send them in generation prompts, or return saved keys to the browser. The password input is cleared after saving. Provider calls happen on the server and use fixed official API hosts; redirects are rejected.
- The provider receives the draft/selected passage, product evidence, and bounded, redacted source excerpts. Private repository evidence is included when you generate from a private repository. Provider data policies apply. OpenAI requests use `store: false`; this is not a promise about all provider-side retention.
- Removing a key deletes the live database record. Historical database backups can retain encrypted records according to the host's backup policy. Revoke a key in your provider console if it should no longer authorize requests.

Keep `SESSION_SECRET` stable, private, and at least 32 characters long. It encrypts both GitHub tokens and personal AI keys. Changing it makes existing encrypted credentials unreadable; users must reconnect GitHub and replace their saved AI key. No provider key or new environment variable is needed for the app to offer BYOK. The credentials table is created automatically by either database adapter.

## Development and verification

```bash
npm test
npm run typecheck
# With the dev server running:
npm run test:byok-browser
```

Unit tests cover encrypted storage, account isolation, replacement/removal, both provider request formats, model access checks, provider errors, selected-text preservation, and the factual gate. The browser check exercises signed-out API protections and the signed-in settings flow with mocked account/provider responses. These tests never use a real API key or incur generation charges. Live model quality and billing behavior require testing with your own configured account.

Deploy normally with `npm run deploy -- --app-only` when the existing Cloudflare routing is already configured. See [deployment](deployment.md).

Provider references: [OpenAI structured output and JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs), [OpenAI model discovery](https://developers.openai.com/api/reference/resources/models/methods/list), [Anthropic Messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages), [Anthropic model discovery](https://platform.claude.com/docs/en/api/models/list).
