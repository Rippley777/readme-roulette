# Azure deployment

See [the deployment guide](deployment.md) for the supported commands, prerequisites, environment variables, verification and recovery.

Routine Azure-only update:

```sh
npm run deploy -- --app-only
```

The app uses Linux App Service F1, a Node 22 standalone server, and an Azure SQL free-offer database configured to pause at its free limit. Docker builds Linux x64 artifacts locally; deployment uploads a ZIP rather than pushing a container image. SQLite remains the local default.

Infrastructure is defined in [deploy/azure.json](../deploy/azure.json). The implementation lives in [scripts/azure_deploy.py](../scripts/azure_deploy.py); the original `scripts/azure-deploy.py` command remains as a compatibility entry point. Routine deployments preserve live data and the current public URL.

The public hostname is `readmeroulette.oddware.dev`; the Azure origin is `readme-roulette-daac2bd8.azurewebsites.net`. Cloudflare provides the public hostname without an Azure custom-domain binding. Use the public URL for GitHub OAuth and browser writes.
