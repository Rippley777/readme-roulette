import assert from 'node:assert/strict';
import { chromium, firefox } from '@playwright/test';

// Uses fresh, signed-out browser contexts. Never grants GitHub access or exchanges a code.
const baseUrl = new URL(process.env.TEST_BASE_URL || 'https://readmeroulette.oddware.dev').origin;
assert.equal(new URL(baseUrl).protocol, 'https:', 'Use the public HTTPS origin.');
const insecureUrl = new URL('/api/auth/github?scope=private', baseUrl);
insecureUrl.protocol = 'http:';
const redirect = await fetch(insecureUrl, {
  redirect: 'manual',
  signal: AbortSignal.timeout(20000),
});
assert.ok(
  [301, 302, 307, 308].includes(redirect.status),
  'HTTP must redirect before serving login.',
);
assert.equal(redirect.headers.get('location'), baseUrl + '/api/auth/github?scope=private');

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const insecureRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).protocol === 'http:')
        insecureRequests.push(new URL(request.url()).origin);
    });
    const login = await context.request.get(baseUrl + '/api/auth/github', { maxRedirects: 0 });
    assert.equal(login.status(), 307);
    const destination = new URL(login.headers().location);
    assert.equal(destination.origin, 'https://github.com');
    assert.equal(destination.pathname, '/login/oauth/authorize');
    assert.equal(destination.searchParams.get('redirect_uri'), baseUrl + '/api/auth/callback');
    const state = (await context.cookies(baseUrl)).find(
      (cookie) => cookie.name === 'rr_oauth_state',
    );
    assert.ok(state?.secure && state.httpOnly && state.sameSite === 'Lax');
    assert.equal(state.domain, new URL(baseUrl).hostname);
    assert.equal(state.value, destination.searchParams.get('state'));
    await page.goto(destination.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(new URL(page.url()).origin, 'https://github.com');
    assert.match(await page.title(), /Sign in to GitHub/);
    await page.locator('input[name="login"]').waitFor();
    assert.deepEqual(insecureRequests, []);
    // Exercise the callback with valid state but no authorization code, as for cancelled login.
    const callback = await context.request.get(
      baseUrl + '/api/auth/callback?state=' + encodeURIComponent(state.value),
      { maxRedirects: 0 },
    );
    assert.equal(callback.status(), 307);
    assert.equal(callback.headers().location, baseUrl + '/?auth=cancelled');
    assert.equal(
      (await context.cookies(baseUrl)).some((cookie) => cookie.name === 'rr_oauth_state'),
      false,
    );
    console.log(
      `${engine.name()}: trusted HTTPS, secure OAuth cookie, GitHub sign-in and cancelled callback passed.`,
    );
  } finally {
    await browser.close();
  }
}
console.log(
  'Signed-out checks passed. Completing account authorization still requires a user login.',
);
