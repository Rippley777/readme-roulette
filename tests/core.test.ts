import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, redact, analyzeFiles, RepositoryAnalyzer } from '../src/lib/analyzer';
import { demoRepos } from '../src/lib/demo';
import { DemoProvider } from '../src/lib/github';
import { DocumentationGenerator } from '../src/lib/generator';
import { scoreRepository } from '../src/lib/score';

test('sensitive paths and generated artifacts are excluded', () => {
  for (const path of [
    '.env',
    '.env.local',
    'server/.env.production',
    'credentials.json',
    'config/secrets.yml',
    'private_key.txt',
    'tls/server.pem',
    'id_rsa',
    'node_modules/react/index.js',
    'dist/app.js',
    'package-lock.json',
  ])
    assert.equal(safePath(path), false, path);
  for (const path of ['.env.example', '.env.sample', 'src/App.tsx', 'package.json'])
    assert.equal(safePath(path), true, path);
});
test('redacts known token patterns and assigned secrets', () => {
  const secret = 'ghp_' + 'x'.repeat(36);
  const result = redact(
    `token=${secret}\npassword="hunter2"\npostgres://admin:secret@localhost/db`,
  );
  assert.ok(!result.includes(secret));
  assert.ok(!result.includes('hunter2'));
  assert.ok(!result.includes('admin:secret'));
});
test('environment templates contribute names only', () => {
  const a = analyzeFiles(
    demoRepos[0],
    [
      {
        path: '.env.example',
        sha: '1',
        content: 'DATABASE_URL=postgres://secret:secret@host/db\nAPI_KEY=super-secret-value',
      },
      { path: '.env', sha: '2', content: 'EXCLUDED_SECRET=private' },
    ],
    ['.env.example', '.env'],
    'head',
  );
  assert.deepEqual(a.env, ['API_KEY', 'DATABASE_URL']);
  assert.ok(!JSON.stringify(a).includes('super-secret-value'));
  assert.ok(!JSON.stringify(a).includes('EXCLUDED_SECRET'));
  assert.ok(!a.files.includes('.env'));
});
test('generation uses declared commands and source evidence', async () => {
  const a = await new RepositoryAnalyzer(new DemoProvider()).analyze(demoRepos[0]);
  const markdown = new DocumentationGenerator().generate(a);
  assert.match(markdown, /npm run dev/);
  assert.doesNotMatch(markdown, /package.json/);
  assert.match(markdown, /PORT=\n/);
  assert.ok(!markdown.includes('postgres://'));
  assert.ok(!markdown.includes('npm run deploy'));
  assert.ok(a.evidence.some((e) => e.name === 'React' && e.source === 'package.json'));
});
test('unverified startup commands are not fabricated', () => {
  const a = analyzeFiles(demoRepos[0], [], [], 'head');
  const markdown = new DocumentationGenerator().generate(a);
  assert.ok(!markdown.includes('npm install'));
  assert.ok(!markdown.includes('npm run dev'));
  assert.doesNotMatch(markdown, /## (?:Quick start|Features|What it does)/);
});
test('profiles preserve facts and score criteria sum to 100', async () => {
  const a = await new RepositoryAnalyzer(new DemoProvider()).analyze(demoRepos[0]);
  const generator = new DocumentationGenerator();
  const professional = generator.generate(a, 'Professional');
  const playful = generator.generate(a, 'Chaotic Good');
  assert.notEqual(professional, playful);
  for (const output of [professional, playful]) {
    assert.match(output, /React/);
    assert.match(output, /npm run dev/);
  }
  const score = scoreRepository(a.repo, professional);
  assert.equal(
    score.criteria.reduce((n, c) => n + c.points, 0),
    100,
  );
  assert.equal(
    score.total,
    score.criteria.reduce((n, c) => n + c.earned, 0),
  );
  assert.equal(score.criteria.find((c) => c.label === 'Screenshots')?.earned, 0);
});

test('publishing rejects a stale README before making any writes', async () => {
  const { GitHubProvider } = await import('../src/lib/github');
  const provider = new GitHubProvider('test');
  const calls: { path: string; method: string }[] = [];
  provider.request = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET' });
    return { sha: 'new-sha' };
  };
  await assert.rejects(
    () => provider.publish(demoRepos[0], '# Updated', 'pr', 'old-sha', 'README.md'),
    /README changed/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('pull request publishing writes a fresh branch and preserves the expected SHA', async () => {
  const { GitHubProvider } = await import('../src/lib/github');
  const provider = new GitHubProvider('test');
  const writes: { path: string; body: any }[] = [];
  provider.request = async (path, options = {}) => {
    if (!options.method)
      return path.includes('/contents/') ? { sha: 'known-sha' } : { object: { sha: 'head-sha' } };
    writes.push({ path, body: JSON.parse(options.body as string) });
    return path.endsWith('/pulls') ? { html_url: 'https://github.com/example/project/pull/1' } : {};
  };
  const result = await provider.publish(demoRepos[0], '# Reviewed', 'pr', 'known-sha', 'README.md');
  assert.equal(writes.length, 3);
  assert.match(writes[0].body.ref, /^refs\/heads\/readme-roulette\//);
  assert.equal(writes[1].body.sha, 'known-sha');
  assert.notEqual(writes[1].body.branch, demoRepos[0].defaultBranch);
  assert.equal(Buffer.from(writes[1].body.content, 'base64').toString(), '# Reviewed');
  assert.equal(writes[2].body.base, demoRepos[0].defaultBranch);
  assert.match(result.url, /\/pull\/1$/);
});
