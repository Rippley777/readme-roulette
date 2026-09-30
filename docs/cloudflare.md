# Cloudflare proxy deployment

See [the deployment guide](deployment.md) for the complete Azure + Cloudflare workflow and GitHub OAuth settings.

To publish only the proxy and configure the app's public URL:

```sh
npm run deploy:login
npm run deploy -- --proxy-only
```

The Worker serves `https://readmeroulette.oddware.dev` and fetches `https://readme-roulette-daac2bd8.azurewebsites.net` using Azure's hostname. Cloudflare's Custom Domain supplies DNS and TLS. A plain CNAME directly to Azure cannot replace the Worker on F1.

The target and route are defined in [wrangler.jsonc](../deploy/cloudflare/wrangler.jsonc), and the proxy implementation is [worker.js](../deploy/cloudflare/worker.js). Keep the configuration valid JSON so the deployment helper can read the same URLs. The proxy preserves request bodies, cookies, OAuth redirects and the browser's `Origin`; API responses are not cached.

The deploy script verifies that the public API responds before switching Azure's `APP_URL`. For a domain already serving the app, `npm run deploy:configure` performs that switch without republishing the Worker or requiring a local Cloudflare login.

GitHub's authorization callback must be `https://readmeroulette.oddware.dev/api/auth/callback`.
