import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFiles, RepositoryAnalyzer } from '../src/lib/analyzer';
import { DemoProvider } from '../src/lib/github';
import { demoRepos, demoFiles } from '../src/lib/demo';
import { DocumentationGenerator, inspectDraft, tones, renderDraft } from '../src/lib/generator';
import { generateReadme } from '../src/lib/generation-service';
import { reviewDraft, validateCandidate, bannedLanguage } from '../src/lib/readme-quality';
import { splitMarkdown, replaceSection } from '../src/lib/markdown-sections';
import { Repository, RepoFile } from '../src/lib/types';
import { scoreRepository } from '../src/lib/score';
const generator = new DocumentationGenerator();
const port = () => new RepositoryAnalyzer(new DemoProvider()).analyze(demoRepos[0]);
function fixture(
  name: string,
  description: string,
  contents: Record<string, string>,
  extra: string[] = [],
) {
  const repo: Repository = { ...demoRepos[0], name, fullName: `example/${name}`, description };
  const files: RepoFile[] = Object.entries(contents).map(([path, content]) => ({
    path,
    content,
    sha: path,
  }));
  return analyzeFiles(repo, files, [...Object.keys(contents), ...extra], 'test-head');
}
const manifest = JSON.stringify({
  name: 'paper-trail',
  private: true,
  scripts: { dev: 'vite', test: 'vitest run' },
  dependencies: { react: '19.0.0' },
  devDependencies: { vite: '6.0.0', typescript: '5.8.0' },
});

test('product model connects visible controls to implementations and ranks the core behavior first', async () => {
  const a = await port();
  assert.equal(a.product?.kind, 'web app');
  assert.equal(a.product?.features[0].id, 'ports');
  const kill = a.product?.features.find((f) => f.id === 'terminate');
  assert.ok(kill);
  assert.ok(kill.sources.some((s) => s.path === 'src/App.tsx'));
  assert.ok(kill.sources.some((s) => s.path === 'server/routes.ts'));
  const text = generator.generate(a);
  assert.match(text, /listening ports/);
  assert.match(text, /Stop a process/);
  assert.doesNotMatch(
    text,
    /restart|Rust|desktop|Includes Vitest|package\.json|Dockerfile|This documentation is based/i,
  );
  assert.doesNotMatch(
    splitMarkdown(text).find((s) => s.title === 'What it does')!.body,
    /React|TypeScript|Vitest|Docker/,
  );
  assert.ok(
    inspectDraft(generator.draft(a), a).some((s) =>
      s.claims.some((c) => c.sources.some((r) => r.path === 'server/routes.ts')),
    ),
  );
});

test('a repository name and dependency list cannot manufacture product features', () => {
  const a = fixture('port-authority', 'A little control tower for local development.', {
    'package.json': manifest,
    'src/App.tsx': 'export default function App(){return <main>Dashboard</main>}',
  });
  assert.equal(a.product?.features.length, 0);
  const text = generator.generate(a);
  assert.doesNotMatch(
    text,
    /## (?:Features|What it does)|Kill|Stop a process|listening ports|Restart/,
  );
  assert.ok(a.product?.unknowns.length);
});

test('comments, string examples, test code, empty handlers, and roadmap promises are not working features', () => {
  const a = fixture('socket-room', 'Inspect development services.', {
    'package.json': manifest,
    'src/App.tsx': `const note="execFile('lsof', ['-iTCP'])";
  // execFile('lsof', ['-iTCP']);
  function killProcess(){} function restartService(){}
  export default function App(){return <><button onClick={killProcess}>Kill process</button><button onClick={restartService}>Restart service</button></>}`,
    'tests/ports.test.ts': `execFile('lsof',['-iTCP']);process.kill(42);`,
    'README.md':
      '# Socket Room\n\n## Roadmap\n\n- Restart services\n\n## Features\n\n- Kill processes (planned)\n- Cannot restart services yet\n',
  });
  assert.equal(a.product?.features.length, 0);
  assert.doesNotMatch(generator.generate(a), /listening ports|Restart service|Kill process/);
});

test('ordinary lsof file inspection does not become a port scanner', () => {
  const a = fixture('file-view', 'Inspect open files.', {
    'src/main.ts': "execFile('lsof', ['/tmp/report.txt'], callback)",
  });
  assert.ok(!a.product?.features.some((f) => f.id === 'ports'));
});

test('unrelated refresh timers do not become service watch mode', () => {
  const files = Object.fromEntries(demoFiles(demoRepos[0]).map((f) => [f.path, f.content || '']));
  files['src/App.tsx'] =
    `import React from 'react';function updateClock(){setTime(Date.now())};setInterval(updateClock,1000);export default function App(){return <main>Service ports</main>}`;
  const a = fixture('socket-clock', 'Local service inspection.', files);
  assert.ok(a.product?.features.some((f) => f.id === 'ports'));
  assert.ok(!a.product?.features.some((f) => f.id === 'watch'));
});

test('other applications are introduced through their own actions, without port-themed copy', () => {
  const a = fixture('paper-trail', 'A quiet place to keep your notes.', {
    'package.json': manifest,
    'src/App.tsx': `import React from 'react';function saveNote(){localStorage.setItem('note',draft)};function removeNote(){setNotes(notes.filter(note=>note.id!==selected))}export default function App(){return <main><h1>Paper Trail</h1><button onClick={saveNote}>Save a note</button><button onClick={removeNote}>Delete a note</button></main>}`,
  });
  const text = generator.generate(a);
  assert.match(text, /save a note/);
  assert.match(text, /Delete a note/);
  assert.doesNotMatch(text, /ports|localhost|PID|control tower|graveyard/);
  assert.match(text, /A quiet place/);
});

test('CLI declarations produce command-specific sections and preserve documented invocations', () => {
  const a = fixture('repo-reaper', 'Find repositories you no longer maintain.', {
    'package.json': JSON.stringify({
      name: 'repo-reaper',
      bin: { reaper: 'cli.js' },
      dependencies: { commander: '13.0.0' },
    }),
    'cli.js': `program.command('scan <directory>').description('Find inactive repositories in a directory').action(scan);program.command('archive <name>').description('Archive a selected repository').action(archive);`,
    'README.md': '# Repo Reaper\n\n## Usage\n\n```bash\nreaper scan ./projects\n```\n',
  });
  assert.equal(a.product?.kind, 'CLI');
  const text = generator.generate(a);
  assert.match(text, /## Commands/);
  assert.match(text, /reaper scan .\/projects/);
  assert.match(text, /inactive repositories/);
  assert.doesNotMatch(text, /listening ports|## Screenshots|could not be verified/);
});

test('API features require matching handler operations, not just route names', () => {
  const a = fixture('tiny-notes', 'An HTTP API for notes.', {
    'server.ts': `app.post('/notes',async(req,res)=>res.json(await db.notes.create(req.body)));app.get('/notes',async(req,res)=>res.json(await db.notes.findMany()));app.post('/restart',()=>({planned:true}));`,
  });
  assert.equal(a.product?.kind, 'server');
  const text = generator.generate(a);
  assert.match(text, /create notes/i);
  assert.match(text, /list notes/i);
  assert.doesNotMatch(text, /restart/i);
});

test('library exports use their documented behavior, not their dependency list', () => {
  const a = fixture('row-reader', 'Read CSV rows without a parser framework.', {
    'package.json': JSON.stringify({ name: 'row-reader', exports: './index.js' }),
    'index.ts':
      '/** Parse a CSV row into individual cells. */\nexport function parseRow(row:string){return row.split(",");}',
  });
  assert.equal(a.product?.kind, 'library');
  const text = generator.generate(a);
  assert.match(text, /parse a CSV row into individual cells/i);
  assert.doesNotMatch(text, /ports|## Quick start|modern technologies/);
});

test('real screenshot assets are embedded; a dashboard is chosen before detail images', () => {
  const a = fixture(
    'paper-trail',
    'A quiet place to keep notes.',
    {
      'package.json': manifest,
      'README.md':
        '# Paper Trail\n\n![Detail](docs/screenshots/detail.png)\n![Main dashboard](docs/screenshots/dashboard.png)\n![Logo](assets/logo.png)\n![Missing](docs/screenshots/missing.png)',
    },
    [
      'docs/screenshots/detail.png',
      'docs/screenshots/dashboard.png',
      'assets/logo.png',
      'src/random.png',
    ],
  );
  assert.equal(a.product?.screenshots.length, 2);
  assert.equal(a.product?.screenshots[0].path, 'docs/screenshots/dashboard.png');
  const text = generator.generate(a);
  assert.match(text, /## Screenshots/);
  assert.ok(text.indexOf('dashboard.png') < text.indexOf('detail.png'));
  assert.doesNotMatch(text, /missing.png|random.png|logo.png|Recommended screenshots/);
});

test('missing screenshots leave only a hidden actionable checklist and earn no screenshot points', async () => {
  const a = await port(),
    text = generator.generate(a);
  assert.doesNotMatch(text, /## Screenshots|### Main experience|### Details/);
  assert.match(text, /<!--\nRecommended screenshots:/);
  assert.equal(
    scoreRepository(a.repo, text).criteria.find((c) => c.label === 'Screenshots')?.earned,
    0,
  );
});

test('all tones preserve facts and commands while changing the writing strategy', async () => {
  const a = await port();
  const outputs = tones.map((tone) =>
    generator.generate(a, 'Professional', undefined, undefined, tone),
  );
  assert.equal(new Set(outputs).size, 4);
  for (const text of outputs) {
    assert.match(text, /process/);
    assert.match(text, /npm run dev/);
    assert.match(text, /React \^19.0.0/);
    assert.doesNotMatch(text, /restart|seamlessly|robust|cutting.edge/i);
  }
  const commands = outputs.map((text) => text.match(/```bash\n[\s\S]*?```/)?.[0]);
  assert.equal(new Set(commands).size, 1);
  assert.match(outputs[3], /mystery tenant/);
  assert.doesNotMatch(outputs[0], /detective story|mystery tenant/);
});

test('personal motivation is preserved only when the author actually supplied it', async () => {
  const a = await port();
  assert.doesNotMatch(generator.generate(a, 'Portfolio'), /I built|I got tired|I wanted/);
  const b = fixture('paper-trail', 'A place to write notes.', {
    'README.md':
      '# Paper Trail\n\n## Why I built this\n\nI wanted a place to keep workshop notes without setting up a whole workspace.\n',
  });
  assert.match(generator.generate(b, 'Portfolio'), /## Why I built this/);
  assert.match(generator.generate(b), /I wanted a place to keep workshop notes/);
});

test('quality review removes repeated sentences, empty sections, and dependency features without altering commands', async () => {
  const a = await port();
  const draft = generator.draft(a);
  const original = draft.sections.find((s) => s.id === 'Getting Started')!.body;
  draft.sections.push(
    { id: 'Overview', title: 'Overview', body: draft.introduction, claimIds: [] },
    { id: 'Empty', title: 'Empty', body: '### Future\n\n<!-- Nothing here -->', claimIds: [] },
  );
  draft.sections.find((s) => s.id === 'Features')!.body +=
    '\n- Includes Vitest in the project tooling.\n- A powerful tool for streamlining your workflow.';
  const reviewed = reviewDraft(draft, a);
  const text = renderDraft(reviewed.draft);
  assert.doesNotMatch(text, /## Overview|## Empty|Includes Vitest|A powerful tool/);
  assert.equal(reviewed.draft.sections.find((s) => s.id === 'Getting Started')!.body, original);
  assert.ok(reviewed.issues.some((i) => i.rule === 'repetition'));
  assert.ok(reviewed.issues.some((i) => i.rule === 'empty-section'));
});

test('external writing gets tone-specific instructions and a grounded product model', async () => {
  const a = await port();
  const result = await generateReadme(a, { tone: 'Developer' }, async (request) => {
    assert.equal(request.tone.name, 'Developer');
    assert.equal(request.task, 'readme_generation_v2');
    assert.ok(request.product.features.some((f) => f.id === 'ports'));
    assert.ok(request.constraints.some((s) => s.includes('Never invent')));
    const draft = structuredClone(request.baseline);
    draft.introduction =
      'Port Authority shows you the process behind a listening port and lets you stop it from the service list.';
    return { draft };
  });
  assert.equal(result.provider, 'http');
  assert.match(result.markdown, /process behind a listening port/);
  assert.ok(!('qualityScore' in result));
});

test('invented behavior gets one repair attempt, then a safe local fallback', async () => {
  const a = await port();
  let calls = 0;
  const result = await generateReadme(a, { tone: 'Unhinged' }, async (request) => {
    calls++;
    const draft = structuredClone(request.baseline);
    draft.introduction =
      'Restart services on Windows in 12 milliseconds with PostgreSQL cloud sync.';
    if (calls === 2) assert.ok(request.issues?.some((i) => i.rule === 'unsupported-claim'));
    return { draft };
  });
  assert.equal(calls, 2);
  assert.equal(result.provider, 'local-fallback');
  assert.doesNotMatch(result.markdown, /restart|Windows|PostgreSQL|milliseconds|cloud sync/i);
});

test('a repaired provider response is accepted; invalid identifiers and changed commands are rejected', async () => {
  const a = await port();
  const baseline = generator.draft(a);
  const bad = structuredClone(baseline);
  bad.sections.find((s) => s.id === 'Getting Started')!.body += '\nnpm run deploy';
  bad.openingClaimIds = ['invented'];
  const issues = validateCandidate(bad, baseline, a);
  assert.ok(issues.some((i) => i.rule === 'changed-fact'));
  assert.ok(issues.some((i) => i.rule === 'unknown-evidence'));
  let calls = 0;
  const result = await generateReadme(a, {}, async (request) => {
    calls++;
    const draft = structuredClone(request.baseline);
    if (calls === 1) draft.introduction = 'A powerful tool for seamlessly managing ports.';
    return { draft };
  });
  assert.equal(calls, 2);
  assert.equal(result.provider, 'http');
  assert.ok(!bannedLanguage.test(result.markdown));
});

test('source evidence remains private to inspection, not appended to product prose', async () => {
  const a = await port();
  const result = await generateReadme(a, {});
  assert.doesNotMatch(
    result.markdown,
    /src\/App.tsx|server\/routes.ts|claim-\d|confidence|repository’s manifests/,
  );
  assert.ok(JSON.stringify(result.inspection).includes('server/routes.ts'));
});

test('section editing respects headings inside code fences and preserves unrelated sections', () => {
  const text = '# Test\n\n## Usage\n\n```md\n## Example heading\n```\n\n## License\n\nMIT\n';
  assert.equal(splitMarkdown(text).length, 3);
  const updated = replaceSection(text, 'License', 'Apache-2.0');
  assert.match(updated, /## Example heading/);
  assert.match(updated, /Apache-2.0/);
  assert.doesNotMatch(updated, /\bMIT\b/);
});

test('existing text-only provider adapters still pass through the new quality gate', async () => {
  const a = await port();
  const good = await generateReadme(a, {}, async (request) => {
    assert.match(request.instruction, /Personality/);
    return { text: request.text };
  });
  assert.equal(good.provider, 'http');
  const bad = await generateReadme(a, {}, async (request) => ({
    text: request.text.replace(
      'A busy port should not turn into a detective story.',
      'Restart every service on Windows instantly.',
    ),
  }));
  assert.equal(bad.provider, 'local-fallback');
  assert.doesNotMatch(bad.markdown, /Restart every|Windows/);
});

test('product behavior survives a project rename instead of using a name-specific template', () => {
  const files = Object.fromEntries(
    demoFiles(demoRepos[0]).map((f) => [
      f.path,
      (f.content || '')
        .replaceAll('port-authority', 'socket-desk')
        .replaceAll('Port Authority', 'Socket Desk'),
    ]),
  );
  const a = fixture('socket-desk', 'Inspect local services from one place.', files);
  const text = generator.generate(a);
  assert.match(text, /# Socket Desk/);
  assert.match(text, /listening ports/);
  assert.doesNotMatch(text, /Port Authority|port-authority/);
});

test('supported technologies cannot mask an invented technology in the same sentence', async () => {
  const a = await port(),
    baseline = generator.draft(a),
    candidate = structuredClone(baseline);
  candidate.introduction = 'Port Authority inspects listening ports using React and Rust.';
  assert.ok(validateCandidate(candidate, baseline, a).some((i) => i.detail.includes('Rust')));
});

test('empty nested headings are removed without stripping headings in fenced examples', async () => {
  const a = await port(),
    draft = generator.draft(a);
  draft.sections.push({
    id: 'Usage',
    title: 'Usage',
    body: '### A real example\n\n```md\n### Example heading\n```\n\n### Empty details\n\n<!-- Add later -->',
    claimIds: [],
  });
  const result = reviewDraft(draft, a);
  const text = renderDraft(result.draft);
  assert.doesNotMatch(text, /### Empty details/);
  assert.match(text, /### Example heading/);
  assert.ok(result.issues.some((i) => i.rule === 'empty-heading'));
});
