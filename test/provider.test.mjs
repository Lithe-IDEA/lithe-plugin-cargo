import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { modelFromMetadata, registerCargoProvider } from '../io.github.lithe-idea.cargo-build/backend/provider.mjs';

async function fixture(t) {
  const scratch = await mkdtemp(join(tmpdir(), 'lithe-cargo-unit-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const root = await realpath(scratch);
  for (const path of ['app/src', 'app/examples', 'app/tests', 'util/src']) await mkdir(join(root, path), { recursive: true });
  for (const path of ['app/src/main.rs', 'app/examples/demo.rs', 'app/tests/smoke.rs', 'util/src/lib.rs']) await writeFile(join(root, path), '');
  const metadata = { version: 1, workspace_root: root, workspace_members: ['app-id', 'util-id'], packages: [
    { id: 'app-id', name: 'app', version: '0.1.0', edition: '2021', manifest_path: join(root, 'app/Cargo.toml'), features: { extra: [] }, targets: [
      { name: 'demo', kind: ['bin'], crate_types: ['bin'], src_path: join(root, 'app/src/main.rs') },
      { name: 'demo', kind: ['example'], crate_types: ['bin'], src_path: join(root, 'app/examples/demo.rs') },
      { name: 'smoke', kind: ['test'], crate_types: ['bin'], src_path: join(root, 'app/tests/smoke.rs') }
    ] },
    { id: 'util-id', name: 'util', version: '0.1.0', edition: '2021', manifest_path: join(root, 'util/Cargo.toml'), features: { extra: [] }, targets: [
      { name: 'util', kind: ['lib'], crate_types: ['lib'], src_path: join(root, 'util/src/lib.rs') }
    ] },
    { id: 'dependency', manifest_path: '/fake-registry/dependency/Cargo.toml' }
  ] };
  return { root, metadata };
}

class PluginError extends Error { constructor(code, message) { super(message); this.code = code; } }
async function provider(root, run) {
  const handlers = {};
  const backend = { onInitialize: (fn) => { handlers.initialize = fn; }, build: { model: (fn) => { handlers.model = fn; } } };
  registerCargoProvider(backend, PluginError);
  await handlers.initialize({ params: { rootUri: pathToFileURL(root).href + '/' } });
  return (params) => handlers.model(params, { run, throwIfCancelled() {}, log() {} });
}

test('Cargo membership and same-name target kinds survive deterministic model conversion', { timeout: 5000 }, async (t) => {
  const { root, metadata } = await fixture(t);
  const model = await modelFromMetadata(metadata, root);
  assert.deepEqual(model.projects.map(({ name, path }) => ({ name, path })), [{ name: 'app', path: 'app' }, { name: 'util', path: 'util' }]);
  assert.deepEqual(model.targets.filter((item) => item.name === 'demo').map((item) => item.tags), [['application'], ['example']]);
  assert.deepEqual(model.optionValues.features, ['app/extra', 'util/extra']);
  assert.ok(model.targets.some((item) => item.tags.includes('library')));
  assert.ok(model.targets.some((item) => item.tags.includes('test')));
  assert.deepEqual(await modelFromMetadata({ ...metadata, packages: [...metadata.packages].reverse() }, root), model);
});

test('initialization is passive; metadata uses the host tool and only supported options', { timeout: 5000 }, async (t) => {
  const { root, metadata } = await fixture(t);
  const calls = [];
  const load = await provider(root, async (...args) => { calls.push(args); return { exitCode: 0, stdout: JSON.stringify(metadata) }; });
  assert.equal(calls.length, 0);
  await load({ root: '.', tool: { executable: '/fake-tools/cargo' }, options: { release: true, features: ['app/extra'], offline: true } });
  assert.equal(calls[0][0], '/fake-tools/cargo');
  assert.deepEqual(calls[0][1], ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(root, 'Cargo.toml'), '--offline']);
  assert.equal(calls[0][2].cwd, root);
  assert.ok(calls[0][2].env.PATH.startsWith('/fake-tools:'));
});

test('relative and symlink build-root escapes are refused before Cargo starts', { timeout: 5000 }, async (t) => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'lithe-cargo-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, 'escape'));
  const load = await provider(root, () => assert.fail('Cargo must not start'));
  for (const path of ['../outside', outside, 'escape']) await assert.rejects(load({ root: path }), { code: 'cargo.invalidRoot' });
  await assert.rejects(load({ root: '.', tool: { executable: 'cargo' } }), { code: 'cargo.invalidTool' });
});

test('external target sources and missing workspace members fail instead of publishing a partial model', { timeout: 5000 }, async (t) => {
  const { root, metadata } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'lithe-cargo-source-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'external.rs'), '');
  await symlink(join(outside, 'external.rs'), join(root, 'app/src/external.rs'));
  const changed = structuredClone(metadata);
  changed.packages[0].targets[0].src_path = join(root, 'app/src/external.rs');
  await assert.rejects(modelFromMetadata(changed, root), /target sources/);
  await assert.rejects(modelFromMetadata({ ...metadata, workspace_members: [...metadata.workspace_members, 'missing'] }, root), /every workspace member/);
  await assert.rejects(modelFromMetadata({ ...metadata, workspace_root: join(root, 'app') }, root), /workspace root/);
});

test('failed tools, malformed output and cancellation keep distinct outcomes', { timeout: 5000 }, async (t) => {
  const { root } = await fixture(t);
  const failed = await provider(root, async () => ({ exitCode: 1, stderr: 'manifest is invalid' }));
  await assert.rejects(failed({ root: '.' }), { code: 'cargo.metadataFailed' });
  const malformed = await provider(root, async () => ({ exitCode: 0, stdout: 'invalid json' }));
  await assert.rejects(malformed({ root: '.' }), { code: 'cargo.invalidMetadata' });
  const missing = await provider(root, async () => { throw new Error('ENOENT'); });
  await assert.rejects(missing({ root: '.' }), { code: 'cargo.unavailable' });
  const handlers = {};
  registerCargoProvider({ onInitialize: () => {}, build: { model: (fn) => { handlers.model = fn; } } }, PluginError);
  const cancelled = new Error('cancelled');
  await assert.rejects(handlers.model({ root: '.' }, { throwIfCancelled() { throw cancelled; } }), (error) => error === cancelled);
  let aborted = false;
  const active = {};
  registerCargoProvider({ onInitialize: (fn) => { active.initialize = fn; }, build: { model: (fn) => { active.model = fn; } } }, PluginError);
  await active.initialize({ params: { rootUri: pathToFileURL(root).href } });
  await assert.rejects(active.model({ root: '.' }, {
    throwIfCancelled() { if (aborted) throw cancelled; },
    async run() { aborted = true; throw cancelled; },
    log() { assert.fail('Cancellation must not be logged as a tool failure'); }
  }), (error) => error === cancelled);
});
