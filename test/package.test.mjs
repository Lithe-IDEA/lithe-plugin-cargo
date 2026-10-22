import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPackage } from '../scripts/package.mjs';
import { repository, verifySdk } from '../scripts/verify-sdk.mjs';

test('SDK integrity rejects changed and unpinned vendored files', { timeout: 5000 }, async (t) => {
  await verifySdk();
  const root = await mkdtemp(join(tmpdir(), 'lithe-cargo-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(repository, 'vendor'), join(root, 'vendor'), { recursive: true });
  await cp(join(repository, 'sdk.lock.json'), join(root, 'sdk.lock.json'));
  const lock = JSON.parse(await readFile(join(root, 'sdk.lock.json')));
  const file = join(root, lock.files[0].path);
  const original = await readFile(file);
  await writeFile(file, 'changed SDK');
  await assert.rejects(verifySdk(root), /SHA-256 mismatch/);
  await writeFile(file, original);
  await writeFile(join(root, 'vendor/unpinned.mjs'), '');
  await assert.rejects(verifySdk(root), /Unpinned SDK input/);
});

test('a release cannot package a tag that disagrees with the manifest', { timeout: 5000 }, async () => {
  await assert.rejects(buildPackage(undefined, 'v9.9.9'), /release tag/);
});
