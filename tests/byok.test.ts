import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AISettingsStore } from '../src/lib/ai-settings';
import { AppDatabase, compileStatement } from '../src/lib/database';
import { BYOKProvider, listModels, verifyCredential } from '../src/lib/byok-provider';
import { ProviderError } from '../src/lib/provider-error';
import { encryptSecret, decryptSecret } from '../src/lib/secret-crypto';
import { RepositoryAnalyzer } from '../src/lib/analyzer';
import { DemoProvider } from '../src/lib/github';
import { demoRepos } from '../src/lib/demo';
import { generateReadme } from '../src/lib/generation-service';
import { rewriteSelection } from '../src/lib/rewrite-service';

const credential = {
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'test-key-never-a-real-credential',
};
const analysis = () => new RepositoryAnalyzer(new DemoProvider()).analyze(demoRepos[0]);
const response = (value: unknown) =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  });

test('personal keys are encrypted, account-bound, replaceable, and never included in public settings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roulette-byok-'));
  const db = new AppDatabase(false, directory),
    store = new AISettingsStore(db);
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-encryption-secret-at-least-32-characters';
  try {
    for (const user of ['alice', 'bob'])
      await db.prepare('INSERT OR REPLACE INTO users VALUES (?,?,?)').run(user, user, '');
    assert.deepEqual(await store.publicSettings('alice'), { configured: false });
    assert.deepEqual(await store.save('alice', credential), {
      configured: true,
      provider: 'openai',
      model: 'gpt-test',
    });
    assert.deepEqual(await store.credential('alice'), credential);
    assert.equal(await store.credential('bob'), undefined);
    const row = (await db
      .prepare('SELECT api_key FROM ai_credentials WHERE user_id=?')
      .get('alice')) as { api_key: string };
    assert.notEqual(row.api_key, credential.apiKey);
    assert.ok(!Buffer.from(row.api_key, 'base64').includes(Buffer.from(credential.apiKey)));
    await store.save('bob', { ...credential, apiKey: 'different-test-credential' });
    await db.prepare('UPDATE ai_credentials SET api_key=? WHERE user_id=?').run(row.api_key, 'bob');
    await assert.rejects(
      store.credential('bob'),
      (e: unknown) => e instanceof ProviderError && e.code === 'saved-key-unavailable',
    );
    await store.save('alice', {
      ...credential,
      provider: 'anthropic',
      model: 'claude-test',
      apiKey: 'replacement-test-key',
    });
    assert.equal((await store.credential('alice'))?.apiKey, 'replacement-test-key');
    await store.remove('alice');
    assert.deepEqual(await store.publicSettings('alice'), { configured: false });
    assert.equal((await store.publicSettings('bob')).configured, true);
    // The same helper must still open GitHub tokens created without associated data.
    const legacy = encryptSecret('github-test-token');
    assert.equal(decryptSecret(legacy), 'github-test-token');
    process.env.SESSION_SECRET = 'a-different-server-secret-at-least-32-characters';
    assert.throws(() => decryptSecret(legacy));
    assert.match(
      compileStatement('INSERT OR REPLACE INTO ai_credentials VALUES (?,?,?,?,?)', 'mssql'),
      /api_key=source.api_key/,
    );
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('OpenAI generation uses the chosen model, fixed endpoint, private credentials, and the evidence gate', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${credential.apiKey}`);
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, credential.model);
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_object');
    assert.ok(!JSON.stringify(body).includes(credential.apiKey));
    const request = JSON.parse(body.input);
    assert.equal(request.tone.name, 'Developer');
    assert.ok(request.supportedClaims.length);
    const draft = request.baseline;
    draft.tagline = 'See what is listening on your local ports.';
    return response({ draft });
  });
  const provider = new BYOKProvider(credential);
  const result = await generateReadme(
    await analysis(),
    { tone: 'Developer' },
    provider.writeDraft.bind(provider),
  );
  assert.equal(result.provider, 'http');
  assert.match(result.markdown, /See what is listening/);
  assert.match(result.markdown, /npm run dev/);
  assert.equal(calls, 1);
});

test('Anthropic selected-text rewrites retain code and use Messages API headers and tone', async (t) => {
  const original = 'See teh listening ports.\n\n```sh\nprintf "teh"\n```';
  const expected = original.replace('See teh', 'See the');
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-api-key'), credential.apiKey);
    assert.equal(headers.get('anthropic-version'), '2023-06-01');
    assert.equal(headers.has('Authorization'), false);
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'claude-test');
    const input = JSON.parse(body.messages[0].content);
    assert.equal(input.tone.name, 'Personality');
    assert.equal(input.text, original);
    return Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ text: expected }) }],
    });
  });
  const result = await rewriteSelection(
    original,
    'Fix grammar',
    await analysis(),
    'Personality',
    new BYOKProvider({ ...credential, provider: 'anthropic', model: 'claude-test' }),
  );
  assert.equal(result.provider, 'http');
  assert.equal(result.text, expected);
});

test('unsupported AI claims get one repair attempt before an explicit local fallback', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request = JSON.parse(JSON.parse(init.body as string).input);
    if (calls++) assert.ok(request.issues.length);
    const draft = request.baseline;
    draft.introduction = 'Restart every service on Windows instantly.';
    return response({ draft });
  });
  const provider = new BYOKProvider(credential);
  const result = await generateReadme(await analysis(), {}, provider.writeDraft.bind(provider));
  assert.equal(calls, 2);
  assert.equal(result.provider, 'local-fallback');
  assert.doesNotMatch(result.markdown, /Restart every|Windows instantly/);
});

test('model discovery and saving verify access without a generation request', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    urls.push(url);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    return Response.json({
      data: [
        { id: 'gpt-test' },
        { id: 'gpt-audio' },
        { id: 'gpt-3.5-turbo' },
        { id: 'text-embedding-test' },
        { id: 'o3' },
        null,
      ],
    });
  });
  assert.deepEqual(
    (await listModels('openai', credential.apiKey)).map((m) => m.id),
    ['gpt-test', 'o3'],
  );
  await verifyCredential(credential);
  assert.deepEqual(urls, [
    'https://api.openai.com/v1/models',
    'https://api.openai.com/v1/models/gpt-test',
  ]);
});

test('authentication, quota, network, malformed and incomplete provider responses never silently replace a draft', async (t) => {
  const a = await analysis(),
    provider = new BYOKProvider(credential);
  for (const [reply, code] of [
    [() => new Response(credential.apiKey, { status: 401 }), 'invalid-key'],
    [() => new Response(credential.apiKey, { status: 429 }), 'provider-limit'],
    [() => new Response(credential.apiKey, { status: 404 }), 'invalid-model'],
    [
      () => {
        throw new Error(credential.apiKey);
      },
      'provider-unavailable',
    ],
    [() => Response.json({ status: 'incomplete' }), 'incomplete-response'],
    [() => Response.json({ status: 'completed', output: {} }), 'invalid-response'],
    [() => response({ text: credential.apiKey }), 'invalid-response'],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () => reply());
    const safeError = (e: unknown) =>
      e instanceof ProviderError && e.code === code && !e.message.includes(credential.apiKey);
    await assert.rejects(generateReadme(a, {}, provider.writeDraft.bind(provider)), safeError);
    await assert.rejects(
      rewriteSelection('See listening ports.', 'Fix grammar', a, 'Developer', provider),
      safeError,
    );
    assert.equal(mock.mock.callCount(), 2);
    mock.mock.restore();
  }
});
