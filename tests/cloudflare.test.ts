import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../deploy/cloudflare/worker.js';

const env = {
  PUBLIC_URL: 'https://readmeroulette.oddware.dev',
  AZURE_ORIGIN: 'https://readme-roulette-daac2bd8.azurewebsites.net',
};

test('proxy preserves API bodies, cookies and browser Origin while using the Azure hostname', async () => {
  const realFetch = globalThis.fetch;
  try {
    let outgoing: Request | undefined;
    let options: RequestInit | undefined;
    const response = new Response('{"ok":true}', { headers: { 'Cache-Control': 'no-store' } });
    globalThis.fetch = async (input, init) => {
      outgoing = input as Request;
      options = init;
      return response;
    };
    const body = JSON.stringify({ repo: 'owner/project', markdown: '# A developer’s project' });
    const result = await worker.fetch(
      new Request(env.PUBLIC_URL + '/api/save?view=editor', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Origin: env.PUBLIC_URL,
          Cookie: 'rr_session=example',
          'X-Forwarded-Host': 'forged.example',
        },
      }),
      env,
    );
    assert.equal(result, response);
    assert.equal(outgoing!.url, env.AZURE_ORIGIN + '/api/save?view=editor');
    assert.equal(outgoing!.headers.get('Host'), new URL(env.AZURE_ORIGIN).host);
    assert.equal(outgoing!.headers.get('Origin'), env.PUBLIC_URL);
    assert.equal(outgoing!.headers.get('Cookie'), 'rr_session=example');
    assert.equal(outgoing!.headers.get('X-Forwarded-Host'), new URL(env.PUBLIC_URL).host);
    assert.equal(await outgoing!.text(), body);
    assert.equal(options!.redirect, 'manual');
    assert.deepEqual((options as RequestInit & { cf: unknown }).cf, {
      cacheTtl: 0,
      cacheEverything: false,
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('proxy returns OAuth redirects and separate cookies without following or merging them', async () => {
  const realFetch = globalThis.fetch;
  try {
    const headers = new Headers({
      Location: 'https://github.com/login/oauth/authorize?state=test',
    });
    headers.append('Set-Cookie', 'rr_oauth_state=test; Secure; HttpOnly; SameSite=Lax; Path=/');
    headers.append('Set-Cookie', 'rr_demo=demo; Secure; HttpOnly; SameSite=Lax; Path=/');
    globalThis.fetch = async () => new Response(null, { status: 307, headers });
    const response = await worker.fetch(new Request(env.PUBLIC_URL + '/api/auth/github'), env);
    assert.equal(response.status, 307);
    assert.match(response.headers.get('Location')!, /^https:\/\/github.com/);
    assert.equal(response.headers.getSetCookie().length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('proxy redirects HTTP and refuses unrelated hostnames', async () => {
  const redirect = await worker.fetch(
    new Request('http://readmeroulette.oddware.dev/api/auth/callback?code=test'),
    env,
  );
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('Location'), env.PUBLIC_URL + '/api/auth/callback?code=test');
  const denied = await worker.fetch(new Request('https://other.example/api/session'), env);
  assert.equal(denied.status, 404);
});
