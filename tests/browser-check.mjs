import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1120 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'artifacts/dashboard.png', fullPage: true, animations: 'disabled' });
console.log('title', await page.title());
await page.getByPlaceholder('Find a repository...').fill('plant');
console.log('filtered rows', await page.locator('.repo-table tbody tr').count());
assert.equal(await page.locator('.repo-table tbody tr').count(), 1);
await page.getByPlaceholder('Find a repository...').fill('');
await page.getByRole('button', { name: 'Open port-authority', exact: true }).click();
await page.getByText('Repository inspected', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Generate README', exact: true }).click();
await page.getByLabel('README Markdown source').waitFor();
await page.waitForFunction(() =>
  document.querySelector('textarea')?.value.includes('## Quick start'),
);
console.log(
  'generated characters',
  (await page.getByLabel('README Markdown source').inputValue()).length,
);
const toneGroup = page.getByRole('group', { name: 'README writing tone' });
assert.equal(
  await toneGroup
    .getByRole('button', { name: 'Personality', exact: true })
    .getAttribute('aria-pressed'),
  'true',
);
const personality = await page.getByLabel('README Markdown source').inputValue();
assert.match(personality, /listening ports/);
assert.doesNotMatch(personality, /## Screenshots|Includes Vitest|package.json/);
await toneGroup.getByRole('button', { name: 'Professional', exact: true }).click();
await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('## Features'));
assert.notEqual(await page.getByLabel('README Markdown source').inputValue(), personality);
await toneGroup.getByRole('button', { name: 'Unhinged', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('textarea')?.value.includes('mystery tenant'),
);
await toneGroup.getByRole('button', { name: 'Personality', exact: true }).click();
await page.waitForFunction(
  () =>
    document.querySelector('textarea')?.value.includes('## What it does') &&
    !document.querySelector('textarea')?.value.includes('mystery tenant'),
);
await page.getByRole('button', { name: 'Why this copy?', exact: true }).click();
await page.locator('.generation-inspector details summary').first().click();
assert.ok((await page.locator('.generation-inspector').textContent()).includes('server/routes.ts'));
await page.screenshot({
  path: 'artifacts/generation-inspector.png',
  fullPage: true,
  animations: 'disabled',
});
await page.getByRole('button', { name: 'Why this copy?', exact: true }).click();
await page.screenshot({ path: 'artifacts/editor.png', fullPage: true, animations: 'disabled' });
await page.setViewportSize({ width: 390, height: 844 });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
await page.screenshot({
  path: 'artifacts/tone-mobile.png',
  fullPage: true,
  animations: 'disabled',
});
await page.setViewportSize({ width: 1440, height: 1120 });
await page.getByRole('button', { name: 'Customize', exact: true }).click();
await page.getByLabel('Testing', { exact: true }).uncheck();
assert.ok(!(await page.getByLabel('README Markdown source').inputValue()).includes('## Testing'));
await page.getByLabel('Testing', { exact: true }).check();
assert.ok((await page.getByLabel('README Markdown source').inputValue()).includes('## Testing'));
await page.getByRole('button', { name: 'Regenerate Testing', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Testing regenerated' }).waitFor();
await page.getByRole('button', { name: 'Move Testing up', exact: true }).click();
await page.getByRole('button', { name: 'Customize', exact: true }).click();
const savedMarkdown = await page.getByLabel('README Markdown source').inputValue();
await page.getByRole('button', { name: 'Save version', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Version saved' }).waitFor();
await page.getByLabel('README Markdown source').fill('# Temporary draft');
await page.getByRole('button', { name: 'Version history', exact: true }).click();
await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
assert.equal(await page.getByLabel('README Markdown source').inputValue(), savedMarkdown);
const rejectedWrite = await page.request.post('http://localhost:3000/api/publish', {
  data: { repo: 'alexmorgan/port-authority', markdown: savedMarkdown, reviewed: true, mode: 'pr' },
});
assert.equal(rejectedWrite.status(), 401);
const rejectedOrigin = await page.request.post('http://localhost:3000/api/analyze', {
  headers: { Origin: 'https://untrusted.example' },
  data: { repo: 'alexmorgan/port-authority' },
});
assert.equal(rejectedOrigin.status(), 403);
await page.getByRole('button', { name: 'Review & publish' }).click();
await page.getByText('I reviewed this diff and approve these exact changes.').waitFor();
await page.screenshot({ path: 'artifacts/diff.png', fullPage: true, animations: 'disabled' });
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.getByRole('button', { name: 'Architecture explorer', exact: true }).click();
await page.getByRole('button', { name: 'Tech Stack' }).click();
console.log('evidence rows', await page.locator('.evidence-row').count());
assert.equal(await page.locator('.evidence-row').count(), 5);
await page.getByRole('button', { name: 'All repositories', exact: true }).click();
await page.getByLabel('Select plant-journal').check();
await page.getByRole('button', { name: 'Analyze selected' }).click();
await page.getByText('1 repositories inspected', { exact: true }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Toggle menu' }).click();
await page.getByRole('button', { name: 'Overview', exact: true }).click();
await page.locator('.sidebar.open').waitFor({ state: 'hidden' });
await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true, animations: 'disabled' });
console.log(
  'mobile horizontal overflow',
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
console.log('browser errors', errors);
await browser.close();
if (errors.length) process.exit(1);
