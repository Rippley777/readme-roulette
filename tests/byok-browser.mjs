import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  // Real API authentication and same-origin guards, without supplying any provider credentials.
  assert.equal((await page.request.get(`${baseUrl}/api/ai/settings`)).status(), 401);
  assert.equal(
    (
      await page.request.post(`${baseUrl}/api/ai/settings`, { data: { operation: 'remove' } })
    ).status(),
    401,
  );
  assert.equal(
    (
      await page.request.post(`${baseUrl}/api/ai/settings`, {
        headers: { Origin: 'https://untrusted.example' },
        data: { operation: 'remove' },
      })
    ).status(),
    403,
  );
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const card = page.locator('.ai-settings');
  await card.getByRole('button', { name: 'Connect GitHub' }).waitFor();
  assert.equal(await card.getByLabel('API key', { exact: true }).count(), 0);

  // Mock only account/provider responses to exercise signed-in UI without paid API requests.
  let settings = { configured: false };
  const requests = [];
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        user: { login: 'byok-test', avatar: '' },
        demo: false,
        configured: true,
        generationProvider: settings.configured ? 'byok' : 'local',
        ai: settings,
      },
    }),
  );
  await page.route('**/api/ai/settings', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.apiKey === 'test-rejected-key')
      return route.fulfill({
        status: 400,
        json: { error: 'The provider rejected your key or its permissions. Check AI settings.' },
      });
    if (body.operation === 'models')
      return route.fulfill({ json: { models: [{ id: 'gpt-test', name: 'Test model' }] } });
    settings =
      body.operation === 'remove'
        ? { configured: false }
        : { configured: true, provider: body.provider, model: body.model };
    return route.fulfill({ json: settings });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const key = card.getByLabel('API key', { exact: true });
  const save = card.getByRole('button', { name: 'Save AI settings', exact: true });
  assert.equal(await save.isDisabled(), true);
  await key.fill('test-rejected-key');
  await card.getByRole('button', { name: 'Check key & load models' }).click();
  await card.getByRole('alert').filter({ hasText: 'provider rejected' }).waitFor();
  assert.equal(settings.configured, false);
  await key.fill('test-browser-key-not-real');
  await card.getByRole('button', { name: 'Check key & load models' }).click();
  await card.getByRole('status').filter({ hasText: 'Key accepted' }).waitFor();
  assert.equal(await card.locator('datalist option').getAttribute('value'), 'gpt-test');
  await card.getByLabel('Model', { exact: true }).fill('gpt-test');
  await save.click();
  await card.getByText('Active: OpenAI · gpt-test', { exact: true }).waitFor();
  assert.equal(await key.inputValue(), '');
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes('test-browser-key'),
    ),
    false,
  );
  await card.getByLabel('Model', { exact: true }).fill('gpt-test-updated');
  await save.click();
  await card.getByText('Active: OpenAI · gpt-test-updated', { exact: true }).waitFor();
  assert.equal(requests.at(-1).apiKey, undefined);
  await card.getByLabel('AI provider', { exact: true }).selectOption('anthropic');
  assert.equal(await save.isDisabled(), true);
  await key.fill('test-anthropic-key-not-real');
  await card.getByLabel('Model', { exact: true }).fill('claude-test');
  await save.click();
  await card.getByText('Active: Anthropic · claude-test', { exact: true }).waitFor();
  mkdirSync('artifacts', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/byok-settings.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({
    path: 'artifacts/byok-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await card.getByRole('button', { name: 'Remove key' }).click();
  await card.getByRole('status').filter({ hasText: 'Key removed' }).waitFor();
  assert.equal(await key.inputValue(), '');
  assert.equal(await card.getByRole('button', { name: 'Remove key' }).count(), 0);
  assert.equal(settings.configured, false);
  assert.deepEqual(errors, []);
  console.log(
    'BYOK browser checks passed: auth guards, model loading, save, saved-key reuse, provider replacement, removal, mobile layout. Provider responses mocked.',
  );
} finally {
  await browser.close();
}
