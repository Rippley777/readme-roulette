# Port Authority

> Put localhost back in order.

A busy port should not turn into a detective story. Port Authority brings listening ports and their owning processes into one view. From there, stop the selected process, open a service in your browser, and search services by port or process.

Your dev server has enough problems without a mystery tenant.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square) ![MIT](https://img.shields.io/badge/license-MIT-a3be8c?style=flat-square)

## What it does

- **See what owns each port** — See listening ports and their owning processes together, so you can identify a service before touching it.
- **Stop a process** — Terminate the selected process from the interface instead of copying its PID into another terminal.
- **Keep the list current** — The service list refreshes automatically while you work.
- **Open the service** — Jump from a running service to its page in your browser.
- **Search services** — Narrow the list as you type, instead of scrolling through every entry.

## Quick start

Requires Node.js >=20.

```bash
git clone https://github.com/alexmorgan/port-authority.git
cd port-authority
npm install
npm run dev
```

## Under the hood

**React ^19.0.0**
Builds the interactive interface and keeps its state in sync with user actions.

**Express ^4.21.0**
Routes HTTP requests to the server handlers.

**Vite ^6.0.0**
Runs the frontend development server and creates the production build.

**Process discovery**
Queries the operating system for listening sockets and process ownership.

**TypeScript ^5.8.0**
Checks the interface code and data shapes during development.

## Configuration

Set these variables for your environment. Keep local values out of version control.

```env
PORT=
```

## Development

| Command | Runs |
| --- | --- |
| `npm run dev` | `vite` |
| `npm run build` | `tsc && vite build` |
| `npm run test` | `vitest run` |
| `npm run lint` | `eslint .` |
| `npm run start` | `vite --host` |

## License

MIT. See [LICENSE](LICENSE) for the terms.

<!--
Recommended screenshots:
1. See what owns each port
2. Stop a process
3. Keep the list current
-->
