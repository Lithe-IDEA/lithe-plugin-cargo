import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repository, verifySdk } from '../../scripts/verify-sdk.mjs';
import { runProcess } from '../../vendor/lithe-plugin-sdk/src/index.mjs';

export const integration = process.env.LITHE_CARGO_INTEGRATION === '1';
export const integrationSkip = integration ? false : 'Prepare Core and set LITHE_CARGO_INTEGRATION=1 for integration tests.';
const binary = join(repository, '.artifacts/core-target/debug/examples/cargo-plugin-harness');
let verified;
async function verifyPreparedCore() {
  await verifySdk();
  const lock = JSON.parse(await readFile(join(repository, 'sdk.lock.json'), 'utf8'));
  const prepared = JSON.parse(await readFile(join(repository, '.artifacts/core-target/prepared.json'), 'utf8'));
  const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(prepared.revision, lock.source.revision, 'Run node scripts/prepare-core.mjs after updating the SDK.');
  assert.equal(prepared.harnessSha256, await digest(join(repository, 'test/core-harness.rs')));
  assert.equal(prepared.binarySha256, await digest(binary), 'Core bridge changed after preparation.');
}

/** Call the real public host boundary, with a deadline for every subprocess. */
export async function core(command, payload) {
  await (verified ??= verifyPreparedCore());
  const result = await runProcess(binary, [JSON.stringify({ command, payload, timeoutMilliseconds: 3000 })], {
    signal: AbortSignal.timeout(5000), maxOutputBytes: 1024 * 1024
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.truncated, false);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.data;
}

export async function build(command, request, expectedStatus = 'ok') {
  const manifest = JSON.parse(await readFile(join(repository, 'io.github.lithe-idea.cargo-build/plugin.json'), 'utf8'));
  const result = await core(command, { manifest, buildSystemID: 'cargo', request });
  assert.equal(result.status, expectedStatus, JSON.stringify(result));
  return result;
}

export async function workspace(t) {
  const scratch = await mkdtemp(join(tmpdir(), 'lithe-cargo-core-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await cp(join(repository, 'test/fixtures/workspace'), join(scratch, 'workspace'), { recursive: true });
  return realpath(join(scratch, 'workspace'));
}
