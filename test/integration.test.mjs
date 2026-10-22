import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildPackage } from '../scripts/package.mjs';
import { TestHost } from '../vendor/lithe-plugin-sdk/test/harness.mjs';
import { runProcess } from '../vendor/lithe-plugin-sdk/src/index.mjs';
import { terminateProcessTree } from '../vendor/lithe-testing/test-timing-lib.mjs';
import { build, integrationSkip } from './support/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
async function snapshot(root) {
  const result = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), `${path}/`);
      else result.push([path, createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex')]);
    }
  }
  await visit(root);
  return result.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

test('packaged provider loads a real Cargo workspace; build/test/run/clean leave its package unchanged', {
  timeout: 90000,
  skip: integrationSkip
}, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'lithe-cargo-integration-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const workspace = join(scratch, 'workspace');
  await cp(join(here, 'fixtures/workspace'), workspace, { recursive: true });
  const root = await realpath(workspace);
  const built = await buildPackage(join(scratch, 'packages'));
  const baseline = await snapshot(built.directory);
  const backend = spawn(process.execPath, [join(built.directory, 'backend/main.mjs')], {
    cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const host = new TestHost(backend);
  t.after(async () => {
    try { await host.close(); }
    finally { if (backend.exitCode === null) await terminateProcessTree(backend); }
  });
  const initialized = await host.initialize({ litheBuild: { versions: [1] } }, pathToFileURL(root).href + '/');
  assert.equal(initialized.result.capabilities.experimental.litheBuild.version, 1);
  const modelPlan = await build('build.modelPlan', { root: '.', options: { offline: true } });
  const loaded = await host.request(modelPlan.plan.provider.method, modelPlan.plan.provider.params);
  assert.equal(loaded.error, undefined, JSON.stringify(loaded.error));
  assert.deepEqual(loaded.result, { format: 'litheBuildModel', version: 1, ...JSON.parse(await readFile(join(here, 'fixtures/model.json'))) });
  const { model } = await build('build.decodeModel', { workspaceRoot: root, root: '.', result: loaded.result });
  const project = model.projects.find((item) => item.name === 'cargo-plugin-demo');
  assert.ok(project);
  const options = { offline: true, release: true, features: model.optionValues.features };
  // Execute the host's plans, so a broken manifest cannot pass by using
  // separately hand-written Cargo command lines in this integration test.
  const cargo = async (command, request) => {
    const { plan } = await build(command, { root: '.', options, ...request });
    return runProcess('cargo', plan.arguments, {
      cwd: join(root, plan.workingDirectory), env: { ...process.env, ...plan.environment, CARGO_TARGET_DIR: join(scratch, 'target') },
      signal: AbortSignal.timeout(20000), maxOutputBytes: 1024 * 1024
    });
  };
  for (const task of ['check', 'build']) {
    const result = await cargo('build.taskPlan', { task });
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const allTests = await cargo('build.testPlan', {});
  assert.equal(allTests.exitCode, 0, allTests.stderr);
  const target = (tag) => {
    const selected = model.targets.find((item) => item.tags.includes(tag) && item.name === (tag === 'test' ? 'smoke' : 'demo'));
    assert.ok(selected, `missing ${tag} target`);
    return selected;
  };
  const binary = await cargo('build.taskPlan', { task: 'run-binary', project, target: target('application') });
  assert.equal(binary.exitCode, 0, binary.stderr);
  assert.equal(binary.stdout.trim(), 'cargo plugin');
  const example = await cargo('build.taskPlan', { task: 'run-example', project, target: target('example') });
  assert.equal(example.exitCode, 0, example.stderr);
  assert.equal(example.stdout.trim(), 'example');
  const selected = await cargo('build.testPlan', { project, target: target('test'), case: 'greeting_is_available' });
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.match(selected.stdout, /1 passed/);
  await writeFile(join(root, 'app/src/main.rs'), 'fn main() { let value: u8 = "wrong"; }');
  const invalid = await cargo('build.taskPlan', { task: 'check', project });
  assert.notEqual(invalid.exitCode, 0);
  assert.match(invalid.stderr, /app\/src\/main.rs:\d+:\d+: error/);
  const diagnostics = await build('build.decodeDiagnostics', { workspaceRoot: root, root: '.', output: invalid.stderr });
  assert.ok(diagnostics.diagnostics.some((item) => item.path === 'app/src/main.rs' && item.severity === 'error'));
  assert.equal((await cargo('build.taskPlan', { task: 'clean' })).exitCode, 0);
  assert.equal((await host.request('shutdown', null)).error, undefined);
  host.notify('exit', null);
  assert.equal(await host.close(), 0);
  assert.deepEqual(await snapshot(built.directory), baseline);
  assert.equal(createHash('sha256').update(await readFile(built.archive)).digest('hex'), built.sha256);
});
