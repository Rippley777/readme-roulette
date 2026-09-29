import { Analysis, Evidence, RepoFile, Repository, RepositoryProvider } from './types';
import { safePath, redact } from './safety';
export { safePath, redact } from './safety';
import { understandProduct } from './product-model';
export function extractEnvironment(content: string) {
  const names = new Set<string>();
  for (const m of content.matchAll(
    /(?:process\.env\.|os\.environ\[\s*["']|os\.getenv\(\s*["']|env::var\(\s*["']|import\.meta\.env\.)([A-Z][A-Z0-9_]+)/g,
  ))
    names.add(m[1]);
  return [...names];
}
export function relevant(path: string) {
  return (
    safePath(path) &&
    (/(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|go\.mod|Dockerfile|docker-compose[^/]*|compose\.ya?ml|Makefile|LICENSE[^/]*|README[^/]*|\.env\.(example|sample|template))$/i.test(
      path,
    ) ||
      /\.(ts|tsx|js|jsx|py|rs|go|ya?ml|toml|json|prisma|sql|md)$/.test(path))
  );
}
export class RepositoryAnalyzer {
  constructor(private provider: RepositoryProvider) {}
  async analyze(repo: Repository): Promise<Analysis> {
    const discovery = await this.provider.files(repo);
    const candidates = discovery.files
      .filter((f) => relevant(f.path) && (f.size ?? 0) < 100_000)
      .sort((a, b) => priority(a.path) - priority(b.path))
      .slice(0, 65);
    const loaded: RepoFile[] = [];
    const failures: string[] = [];
    for (let i = 0; i < candidates.length; i += 6) {
      await Promise.all(
        candidates.slice(i, i + 6).map(async (file) => {
          try {
            loaded.push({ ...file, content: await this.provider.read(repo, file) });
          } catch {
            failures.push(file.path);
          }
        }),
      );
    }
    return analyzeFiles(
      repo,
      loaded,
      discovery.files.filter((f) => safePath(f.path)).map((f) => f.path),
      discovery.headSha,
      failures,
    );
  }
}
function priority(path: string) {
  return /README|package\.json|Cargo\.toml|pyproject|requirements|LICENSE|\.env\.example/.test(path)
    ? 0
    : /(?:App|page|main|cli|index|routes?|commands?|controllers?|services?|components)\b/i.test(
          path,
        )
      ? 1
      : /config|workflow|Dockerfile/.test(path)
        ? 2
        : 3;
}
export function analyzeFiles(
  repo: Repository,
  loaded: RepoFile[],
  paths: string[],
  headSha: string,
  failures: string[] = [],
): Analysis {
  const evidence: Evidence[] = [];
  const scripts: Record<string, string> = {};
  const env = new Set<string>();
  let readme = '';
  let readmeSha: string | undefined;
  let readmePath = 'README.md';
  const add = (name: string, value: string, source: string, category: string) => {
    if (!evidence.some((e) => e.name === name && e.source === source))
      evidence.push({ name, value: redact(value), source, category });
  };
  for (const file of loaded.filter((f) => safePath(f.path))) {
    const raw = file.content || '';
    const text = redact(raw);
    const source = file.path;
    if (/(^|\/)README\.md$/i.test(source) && (!readme || source.indexOf('/') < 0)) {
      readme = text;
      readmeSha = file.sha;
      readmePath = source;
    }
    if (/\.env\.(example|sample|template)$/.test(source)) {
      for (const line of raw.split('\n')) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
        if (match) {
          env.add(match[1]);
          add(match[1], 'Value omitted', source, 'Environment Variables');
        }
      }
      continue;
    }
    for (const name of extractEnvironment(raw)) {
      env.add(name);
      add(name, 'Referenced in source', source, 'Environment Variables');
    }
    if (/(^|\/)package.json$/.test(source)) {
      try {
        const pkg = JSON.parse(raw);
        for (const [name, value] of Object.entries({
          ...pkg.dependencies,
          ...pkg.devDependencies,
        })) {
          const framework: Record<string, string> = {
            react: 'React',
            next: 'Next.js',
            vue: 'Vue',
            svelte: 'Svelte',
            vite: 'Vite',
            typescript: 'TypeScript',
            tailwindcss: 'Tailwind CSS',
            express: 'Express',
            fastify: 'Fastify',
            '@supabase/supabase-js': 'Supabase',
            prisma: 'Prisma',
            vitest: 'Vitest',
            jest: 'Jest',
            '@playwright/test': 'Playwright',
          };
          add(
            framework[name] || name,
            String(value),
            source,
            framework[name]
              ? /vitest|jest|playwright/.test(name)
                ? 'Testing'
                : 'Tech Stack'
              : 'Dependencies',
          );
        }
        for (const [name, value] of Object.entries(pkg.scripts || {})) {
          const key =
            source === 'package.json' ? name : `${source.replace('/package.json', '')}:${name}`;
          scripts[key] = redact(String(value));
          add(key, redact(String(value)), source, 'Scripts');
        }
        if (pkg.engines?.node) add('Node.js', String(pkg.engines.node), source, 'Tech Stack');
      } catch {
        add('Invalid package manifest', 'Could not parse JSON', source, 'Overview');
      }
    }
    if (/Cargo\.toml$/.test(source)) {
      add('Rust', 'Cargo project', source, 'Tech Stack');
      for (const name of ['axum', 'tokio', 'actix-web', 'serde', 'sqlx'])
        if (new RegExp(`^${name}\\s*=`, 'm').test(text))
          add(name, 'Declared dependency', source, 'Dependencies');
    }
    if (/pyproject\.toml|requirements.*\.txt/.test(source)) {
      add('Python', 'Python project', source, 'Tech Stack');
      for (const name of ['fastapi', 'django', 'flask', 'pytest', 'httpx', 'typer'])
        if (text.toLowerCase().includes(name))
          add(name, 'Declared in manifest', source, name === 'pytest' ? 'Testing' : 'Dependencies');
    }
    if (/go\.mod$/.test(source))
      add('Go', text.match(/^go (.+)$/m)?.[1] || 'Version unknown', source, 'Tech Stack');
    if (/Dockerfile$|(?:docker-)?compose\.ya?ml$/.test(source))
      add('Docker', 'Container configuration detected', source, 'Deployment');
    if (/^\.github\/workflows\//.test(source))
      add(
        'GitHub Actions',
        text.match(/^name:\s*(.*)$/m)?.[1] || 'Workflow detected',
        source,
        'Deployment',
      );
    if (/vercel\.json$/.test(source))
      add('Vercel', 'Deployment configuration', source, 'Deployment');
    if (/\.ya?ml$/.test(source) && /azure\/container-apps-deploy-action/.test(text))
      add('Azure Container Apps', 'Deployment action detected', source, 'Deployment');
    if (/\.prisma$/.test(source)) {
      const provider = text.match(/provider\s*=\s*"(postgresql|mysql|sqlite|mongodb)"/);
      if (provider) add(provider[1], 'Database provider configured', source, 'Database');
      for (const m of text.matchAll(/^model\s+(\w+)/gm))
        add(m[1], 'Prisma model', source, 'Database');
    }
    for (const m of text.matchAll(
      /(?:app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g,
    ))
      add(`${m[1].toUpperCase()} ${m[2]}`, 'Route handler', source, 'API');
    if (/app\/.*route\.[tj]s$/.test(source))
      for (const m of text.matchAll(
        /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g,
      ))
        add(
          `${m[1]} /${source.replace(/^.*app\//, '').replace(/\/route\.[tj]s$/, '')}`,
          'Next.js route handler',
          source,
          'API',
        );
  }
  const limitations = [
    'Analysis is limited to 65 text files smaller than 100 KB. Unverified behavior and architecture relationships are not inferred.',
    ...(failures.length
      ? [`${failures.length} files could not be read: ${failures.join(', ')}`]
      : []),
  ];
  const analysis: Analysis = {
    repo,
    files: paths.filter(safePath),
    evidence,
    scripts,
    env: [...env].sort(),
    readme,
    readmeSha,
    readmePath,
    headSha,
    analyzedAt: new Date().toISOString(),
    inspected: loaded.length,
    limitations,
  };
  analysis.product = understandProduct(
    analysis,
    loaded.filter((f) => safePath(f.path)),
  );
  return analysis;
}
