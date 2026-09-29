import { Repository, RepoFile } from './types';
import { portAuthoritySource } from './demo-product';
const entries: [string, string, string, number, number, number, string][] = [
  [
    'port-authority',
    'A little control tower for your local development servers.',
    'TypeScript',
    128,
    12,
    92,
    'complete',
  ],
  [
    'diffusion',
    'A distraction-free space for your next big idea.',
    'TypeScript',
    64,
    8,
    81,
    'complete',
  ],
  [
    'shipwreck',
    'Your containers. Your rules. A Docker management toolkit.',
    'Rust',
    47,
    5,
    74,
    'outdated',
  ],
  [
    'repo-reaper',
    'Find and archive the repositories you’ve left behind.',
    'Python',
    32,
    4,
    63,
    'outdated',
  ],
  [
    'plant-journal',
    'A home for your plants, watering schedules, and little wins.',
    'TypeScript',
    16,
    2,
    41,
    'missing',
  ],
  ['little-api', 'Small, opinionated building blocks for REST APIs.', 'Go', 23, 3, 58, 'outdated'],
  ['dotfiles', 'Making a new machine feel like home.', 'Shell', 9, 1, 86, 'complete'],
  [
    'weekend-weather',
    'A tiny forecast for getting out of the house.',
    'JavaScript',
    12,
    2,
    35,
    'missing',
  ],
];
export const demoRepos: Repository[] = entries.map((r, i) => ({
  id: i + 1,
  name: r[0],
  fullName: `alexmorgan/${r[0]}`,
  description: r[1],
  language: r[2],
  stars: r[3],
  forks: r[4],
  score: r[5],
  readmeStatus: r[6] as Repository['readmeStatus'],
  updatedAt: new Date(Date.now() - (i * 19 + 3) * 3600000).toISOString(),
  private: i === 1 || i === 4,
  defaultBranch: 'main',
  topics: i % 2 ? [] : ['developer-tools', 'open-source'],
  license: i === 4 || i === 7 ? null : 'MIT',
  demo: true,
}));
export function demoFiles(repo: Repository): RepoFile[] {
  const isJs = ['TypeScript', 'JavaScript'].includes(repo.language);
  const files: Record<string, string> = {
    'README.md':
      repo.readmeStatus === 'missing'
        ? ''
        : `# ${repo.name}\n\n${repo.description}\n\n## Getting Started\n\nSetup instructions coming soon.\n`,
    '.env.example': 'PORT=3000\nDATABASE_URL=postgres://example:example@localhost/db\n',
    '.github/workflows/ci.yml':
      'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
    Dockerfile:
      'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["npm", "start"]',
    'src/config.ts':
      'export const port = process.env.PORT;\nexport const database = process.env.DATABASE_URL;',
    'tests/app.test.ts': "import { test } from 'vitest';\ntest('starts successfully', () => {});",
  };
  if (repo.license) files['LICENSE'] = 'MIT License\nCopyright (c) 2026';
  if (isJs) {
    files['package.json'] = JSON.stringify(
      {
        name: repo.name,
        description: repo.description,
        version: '1.0.0',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          test: 'vitest run',
          lint: 'eslint .',
          start: 'vite --host',
        },
        dependencies: {
          react: '^19.0.0',
          ...(repo.name === 'port-authority' ? { express: '^4.21.0' } : {}),
          ...(repo.name === 'plant-journal' ? { '@supabase/supabase-js': '^2.49.0' } : {}),
        },
        devDependencies: { typescript: '^5.8.0', vite: '^6.0.0', vitest: '^3.0.0' },
        engines: { node: '>=20' },
      },
      null,
      2,
    );
    files['src/App.tsx'] =
      'export default function App() { return <main>Project dashboard</main> }';
    files['src/components/Dashboard.tsx'] =
      'export function Dashboard() { return <section>Dashboard</section> }';
  } else if (repo.language === 'Rust')
    files['Cargo.toml'] =
      '[package]\nname = "shipwreck"\nversion = "0.1.0"\n[dependencies]\naxum = "0.8"\ntokio = "1"';
  else if (repo.language === 'Python')
    files['pyproject.toml'] =
      '[project]\nname = "repo-reaper"\nversion = "0.1.0"\ndependencies = ["httpx", "typer"]\n[tool.pytest.ini_options]\ntestpaths = ["tests"]';
  else if (repo.language === 'Go')
    files['go.mod'] = 'module github.com/alexmorgan/little-api\ngo 1.23';
  else files['install.sh'] = '#!/bin/sh\n# Install local shell configuration';
  if (repo.name === 'port-authority') Object.assign(files, portAuthoritySource);
  return Object.entries(files)
    .filter(([, content]) => content)
    .map(([path, content]) => ({
      path,
      content,
      sha: `demo-${repo.id}-${path}`,
      size: content.length,
    }));
}
