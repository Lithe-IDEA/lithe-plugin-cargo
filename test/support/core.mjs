import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repository, verifySdk } from '../../scripts/verify-sdk.mjs';
import { verifyPreparedCore as verifyCoreIdentity } from '../../scripts/core-source.mjs';
import { runProcess } from '../../vendor/lithe-plugin-sdk/src/index.mjs';

export const integration = process.env.LITHE_CARGO_INTEGRATION === '1';
export const integrationSkip = integration ? false : 'Prepare Core and set LITHE_CARGO_INTEGRATION=1 for integration tests.';
const binary = join(repository, '.artifacts/core-target/cargo-plugin-harness');
let verified;
async function verifyPreparedCore() {
  await verifySdk();
  await verifyCoreIdentity(binary, join(repository, 'test/core-harness.rs'));
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
