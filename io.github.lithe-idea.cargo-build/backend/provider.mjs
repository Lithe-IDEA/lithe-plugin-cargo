import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const slash = (value) => value.split(sep).join('/');
const inside = (root, path) => {
  const value = relative(root, path);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
};

/** Cargo owns workspace membership, automatic targets and feature declarations. */
export async function modelFromMetadata(metadata, root) {
  if (metadata.version !== 1 || !Array.isArray(metadata.packages) || !Array.isArray(metadata.workspace_members)) {
    throw new Error('Cargo returned an unsupported metadata document.');
  }
  if (await realpath(metadata.workspace_root) !== root) {
    throw new Error('Open the Cargo workspace root before loading this project.');
  }
  const projects = [], targets = [], contentRoots = [], features = [];
  const members = new Set(metadata.workspace_members);
  for (const pkg of metadata.packages.filter((item) => members.has(item.id))) {
    const directory = await realpath(dirname(pkg.manifest_path));
    if (!inside(root, directory)) throw new Error('Cargo workspace members must be inside the build root.');
    const project = slash(relative(root, directory)) || '.';
    projects.push({ name: pkg.name, path: project, properties: { version: pkg.version, edition: pkg.edition } });
    for (const feature of Object.keys(pkg.features ?? {})) features.push(`${pkg.name}/${feature}`);
    for (const target of pkg.targets ?? []) {
      const kinds = new Set(target.kind);
      const tag = kinds.has('bin') ? 'application' : kinds.has('example') ? 'example'
        : kinds.has('test') ? 'test' : kinds.has('bench') ? 'benchmark'
          : target.crate_types?.length && !kinds.has('custom-build') ? 'library' : null;
      if (!tag) continue;
      const source = await realpath(target.src_path);
      if (!inside(root, source)) throw new Error('Cargo target sources must be inside the build root.');
      targets.push({ name: target.name, project, path: project, tags: [tag] });
      contentRoots.push({ project, path: slash(relative(root, dirname(source))) || '.',
        kind: ['test', 'example', 'benchmark'].includes(tag) ? 'testSource' : 'source' });
    }
  }
  if (projects.length !== members.size || projects.length === 0) throw new Error('Cargo did not return every workspace member.');
  projects.sort((a, b) => compare(a.path, b.path));
  targets.sort((a, b) => compare(`${a.project}/${a.name}/${a.tags[0]}`, `${b.project}/${b.name}/${b.tags[0]}`));
  const uniqueRoots = [...new Map(contentRoots.map((item) => [JSON.stringify(item), item])).values()]
    .sort((a, b) => compare(`${a.project}/${a.path}/${a.kind}`, `${b.project}/${b.path}/${b.kind}`));
  return { projects, targets, contentRoots: uniqueRoots, optionValues: { features: [...new Set(features)].sort(compare) } };
}

/** Register a typed build provider; initialization never executes project tools. */
export function registerCargoProvider(backend, PluginError) {
  let workspaceRoot;
  backend.onInitialize(async ({ params }) => {
    workspaceRoot = await realpath(fileURLToPath(params.rootUri));
  });
  backend.build.model(async ({ root, tool, options = {}, environment = {} }, context) => {
    context.throwIfCancelled();
    if (!workspaceRoot || typeof root !== 'string' || isAbsolute(root) || !inside(workspaceRoot, resolve(workspaceRoot, root))) {
      throw new PluginError('cargo.invalidRoot', 'The Cargo build root is outside the open workspace.');
    }
    let directory;
    try {
      directory = await realpath(resolve(workspaceRoot, root));
      if (!inside(workspaceRoot, directory)) throw new Error('The Cargo build root leaves the workspace through a symbolic link.');
    } catch (error) {
      throw new PluginError('cargo.invalidRoot', error.message);
    }
    const executable = tool?.executable ?? 'cargo';
    if (tool && (typeof executable !== 'string' || !isAbsolute(executable))) {
      throw new PluginError('cargo.invalidTool', 'The Cargo executable supplied by Lithe must be an absolute path.');
    }
    const args = ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', resolve(directory, 'Cargo.toml')];
    if (options.offline === true) args.push('--offline');
    let result;
    try {
      result = await context.run(executable, args, { cwd: directory, env: { ...process.env, ...environment }, maxOutputBytes: 8 * 1024 * 1024 });
    } catch (error) {
      context.throwIfCancelled();
      context.log(error);
      throw new PluginError('cargo.unavailable', 'Cargo could not be started. Install Rust/Cargo and check the build tool path.');
    }
    context.throwIfCancelled();
    if (result.exitCode !== 0) {
      context.log(result.stderr);
      throw new PluginError('cargo.metadataFailed', `Cargo could not load this workspace. Check Cargo.toml and the Offline option. ${result.stderr.trim().slice(0, 2048)}`);
    }
    try {
      const model = await modelFromMetadata(JSON.parse(result.stdout), directory);
      context.throwIfCancelled();
      return model;
    } catch (error) {
      context.throwIfCancelled();
      context.log(error);
      throw new PluginError('cargo.invalidMetadata', error.message);
    }
  });
}
