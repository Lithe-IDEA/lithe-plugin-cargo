import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { repository } from '../scripts/verify-sdk.mjs';
import { build, core, integrationSkip, workspace } from './support/core.mjs';

test('Core validates the distributable manifest and requires a provider-capable host', { timeout: 15000, skip: integrationSkip }, async () => {
  const manifest = JSON.parse(await readFile(join(repository, 'io.github.lithe-idea.cargo-build/plugin.json'), 'utf8'));
  const hostCapabilities = { buildSystems: [1, 2], buildProviders: [1], serverProcess: [1], settings: [1, 2], executableResolution: [1] };
  assert.equal((await core('plugins.declarative.validate', { manifest, hostCapabilities })).status, 'ok');
  const review = await core('plugins.marketplace.installReview', { manifest, hostCapabilities });
  assert.equal(review.status, 'ok');
  for (const kind of ['runtimeBuildProvider', 'buildSystem']) assert.ok(review.review.programs.some((item) => item.kind === kind));
  const oldHost = await core('plugins.declarative.validate', { manifest, hostCapabilities: { ...hostCapabilities, executableResolution: [] } });
  assert.equal(oldHost.error.code, 'plugin.api.unsupported');
  const unsupported = await core('plugins.declarative.validate', { manifest, hostCapabilities: { buildSystems: [1], serverProcess: [1] } });
  assert.equal(unsupported.error.code, 'plugin.api.unsupported');
});

test('Core detects one outermost workspace and decodes the real metadata golden model', { timeout: 15000, skip: integrationSkip }, async (t) => {
  const root = await workspace(t);
  const manifest = JSON.parse(await readFile(join(repository, 'io.github.lithe-idea.cargo-build/plugin.json'), 'utf8'));
  const detected = await core('build.detect', { workspaceRoot: root, plugins: [{ manifest }] });
  assert.equal(detected.status, 'ok');
  assert.deepEqual(detected.detection.instances.map((item) => item.id), ['cargo:.']);
  const result = { format: 'litheBuildModel', version: 1, ...JSON.parse(await readFile(join(repository, 'test/fixtures/model.json'), 'utf8')) };
  const decoded = await build('build.decodeModel', { workspaceRoot: root, root: '.', result });
  assert.equal(decoded.model.projects.length, 2);
  assert.equal(decoded.model.targets.length, 4);
  assert.deepEqual(decoded.model.optionValues.features, ['cargo-plugin-demo/greeting']);
});

test('Core task and test plans preserve package, target kind, option positions and exact case selection', { timeout: 15000, skip: integrationSkip }, async () => {
  const project = { path: 'app', name: 'cargo-plugin-demo' };
  const options = { release: true, offline: true, features: ['cargo-plugin-demo/greeting'] };
  const plan = (await build('build.taskPlan', { root: '.', task: 'build', project, options })).plan;
  assert.deepEqual(plan.arguments.slice(0, 6), ['--color', 'never', 'build', '--message-format=short', '--package', 'cargo-plugin-demo']);
  for (const arg of ['--release', '--offline', 'cargo-plugin-demo/greeting']) assert.ok(plan.arguments.includes(arg));
  assert.deepEqual((await build('build.taskPlan', { root: '.', task: 'clean', options })).plan.arguments, ['--color', 'never', 'clean']);
  for (const [task, tag, selector] of [['run-binary', 'application', '--bin'], ['run-example', 'example', '--example']]) {
    const target = { path: 'app', name: 'demo', tags: [tag] };
    const { plan: run } = await build('build.taskPlan', { root: '.', task, project, target, userArguments: ['hello world'] });
    const index = run.arguments.indexOf(selector);
    assert.ok(index >= 0);
    assert.equal(run.arguments[index + 1], 'demo');
    assert.equal(run.arguments.at(-1), 'hello world');
  }
  const { plan: tests } = await build('build.testPlan', { root: '.', project, target: { path: 'app', name: 'smoke', tags: ['test'] }, case: 'greeting_is_available' });
  assert.deepEqual(tests.arguments, ['--color', 'never', 'test', '--message-format=short', '--package', 'cargo-plugin-demo', '--test', 'smoke', '--', 'greeting_is_available', '--exact']);
  const rejected = await build('build.taskPlan', { root: '.', task: 'run-binary', project, target: { path: 'app', name: 'demo', tags: ['example'] } }, 'rejected');
  assert.equal(rejected.error.code, 'plugin.build.invalidSelection');
});
