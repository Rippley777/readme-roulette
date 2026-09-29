import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepositoryAnalyzer } from '../src/lib/analyzer';
import { DemoProvider } from '../src/lib/github';
import { demoRepos } from '../src/lib/demo';
import { rewriteSelection } from '../src/lib/rewrite-service';
import { HttpAIProvider } from '../src/lib/ai-provider';
const port = () => new RepositoryAnalyzer(new DemoProvider()).analyze(demoRepos[0]);

test('selection rewriting carries tone, repairs unsupported claims and accepts grounded copy', async () => {
  const a = await port();
  let calls = 0;
  const result = await rewriteSelection('Inspect listening ports.', 'Expand', a, 'Unhinged', {
    async rewrite(text, instruction, analysis, options) {
      assert.equal(options?.tone, 'Unhinged');
      assert.equal(analysis.product?.features[0].id, 'ports');
      calls++;
      if (calls === 1) return 'Restart every service on Windows.';
      assert.ok(options?.issues?.some((i) => i.rule === 'unsupported-claim'));
      return 'See listening ports and their owning processes together.';
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.provider, 'http');
  assert.match(result.text, /owning processes/);
});

test('failed provider rewrites use a valid local edit, never invented behavior', async () => {
  const result = await rewriteSelection(
    'The application shows listening ports.',
    'Make more casual',
    await port(),
    'Developer',
    {
      async rewrite() {
        return 'The app restarts services on Windows.';
      },
    },
  );
  assert.equal(result.provider, 'local-fallback');
  assert.equal(result.text, 'The app shows listening ports.');
});

test('grammar edits preserve commands, inline code, links and table values', async () => {
  const original =
    'See teh listening ports.\n\n~~~~sh\nprintf "teh app setup"\n```\n~~~~\n\nUse `app setup` to inspect teh ports.\n\n[Docs](https://example.com/app/setup)\n\n| app | teh |';
  const result = await rewriteSelection(original, 'Fix grammar', await port());
  assert.equal(result.provider, 'local');
  assert.equal(
    result.text,
    original.replace('See teh', 'See the').replace('inspect teh', 'inspect the'),
  );
});

test('provider cannot change an existing executable example or link destination', async () => {
  const original = 'Inspect listening ports with `npm run dev`. [Docs](https://example.com/docs)';
  const result = await rewriteSelection(original, 'Fix grammar', await port(), 'Personality', {
    async rewrite() {
      return original.replace('npm run dev', 'npm run reset').replace('/docs)', '/other)');
    },
  });
  assert.equal(result.provider, 'unchanged');
  assert.equal(result.text, original);
});

test('boilerplate or repeated prose is rejected and an unavailable provider leaves useful text intact', async () => {
  const original = 'Inspect listening ports.';
  for (const output of [
    'A powerful tool for inspecting ports.',
    'See listening ports and their owning processes together. See listening ports and their owning processes together.',
  ]) {
    const result = await rewriteSelection(original, 'Fix grammar', await port(), 'Personality', {
      async rewrite() {
        return output;
      },
    });
    assert.equal(result.provider, 'unchanged');
    assert.equal(result.text, original);
  }
  const unavailable = await rewriteSelection(original, 'Fix grammar', await port(), 'Personality', {
    async rewrite() {
      throw new Error('offline');
    },
  });
  assert.equal(unavailable.text, original);
  assert.equal(unavailable.provider, 'unchanged');
});

test('HTTP selection adapter sends product evidence and distinct tone instructions', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests: Record<string, any>[] = [];
    globalThis.fetch = async (_input, init) => {
      requests.push(JSON.parse(init?.body as string));
      return new Response(JSON.stringify({ text: 'Inspect listening ports.' }));
    };
    const a = await port(),
      provider = new HttpAIProvider('https://example.com/writer', '');
    await provider.rewrite('Inspect ports.', 'Expand', a, { tone: 'Professional' });
    await provider.rewrite('Inspect ports.', 'Expand', a, { tone: 'Unhinged' });
    assert.notEqual(requests[0].instruction, requests[1].instruction);
    assert.equal(requests[1].tone.name, 'Unhinged');
    assert.equal(requests[1].project.features[0].id, 'ports');
    assert.ok(requests[1].supportedClaims.some((f: { id: string }) => f.id === 'terminate'));
    assert.equal(requests[1].project.files, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
