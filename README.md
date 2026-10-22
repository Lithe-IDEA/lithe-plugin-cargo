# Cargo for Lithe (macOS)

Cargo is a community build plugin for Lithe. It uses Lithe's native Cargo
tool window and Build Output to build, check, test, clean, and run Rust projects.

**0.1.1 is a preview release.** Native disk-installation and full UI acceptance
are still pending. Automated integration and host compatibility run in this
repository's CI.
The plugin requires a Lithe preview with API 3 `buildSystems: 2`, `settings: 2`,
`buildProviders: 1` and `serverProcess: 1`. Windows is not supported yet.

## Install

Install Rust/Cargo 1.70+ and Node.js 20.3+ first. Node runs the metadata provider;
Cargo and rust-analyzer are not bundled. Existing Rust language intelligence
continues to use Lithe's Rust language service.

Download `cargo-build-0.1.1-darwin.zip` from [Releases](https://github.com/Lithe-IDEA/lithe-plugin-cargo/releases).
In Lithe, choose Settings → Plugins → Install from Disk, select the ZIP,
review Cargo/Node and its permissions, and restart. Enable Cargo, open the
Cargo workspace root, then open the Cargo tool window and load the project model.
After the [Lithe Store](https://github.com/Lithe-IDEA/Lithe-store) entry is merged,
compatible preview builds can also install it from the plugin marketplace.

## Cargo path

Settings → Plugins → Cargo → Settings contains **Cargo 路径** with a native
file picker. It also appears in Build, Execution, Deployment → Cargo. Leave it
empty for automatic discovery, or select the Cargo executable (not rustc/rustup).
Saving reloads the model; metadata, build, check, test, run and clean use that
same executable. A missing, non-executable or too-old selection fails visibly
instead of silently choosing a different Cargo installation. The executable's
parent directory is placed first on PATH for companion tools.

Version 0.1.1 requires a preview host with `buildSystems: 2` and `settings: 2`.
Its exact tested host revision is recorded in `sdk.lock.json`; older hosts keep
using the compatible 0.1.0 release through the Store. Existing published ZIPs
are immutable and are never replaced.

## Features

- Cargo supplies workspace members, explicit/automatic binaries, libraries,
  integration tests, examples and package-qualified feature names.
- Build and Check run for the workspace or a selected package.
- Test runs for the workspace, a package or an integration-test target.
  Single-case filtering uses the exact Cargo test name.
- Select a binary/example and choose Run Binary / Run Example. Same-name
  binaries and examples remain separate targets.
- Release Profile, Features and Offline apply to build, check, run and test.
- Clean Workspace cleans all profiles without incompatible feature arguments.
- Output, short compiler diagnostics and Stop use Lithe's existing host workflow.

This base version has no dependency tree, debugger integration, custom web page
or graphical per-case report. Cargo's test output and exit status remain available.
Cargo enforces toolchain and required-feature rules. Open the workspace root;
members or target sources outside the selected build root are refused. The host's
`outermost` detection does not list independent nested workspaces separately.

## Develop and verify

Requires Node 20.3+, `zip`, and Cargo for integration tests. Unit tests and
packaging need no npm installation, network service or adjacent Lithe checkout:

```sh
node scripts/verify-sdk.mjs
node scripts/test.mjs
node scripts/package.mjs
```

Full integration also compiles a test-only bridge to Lithe's public
`execute_json` API. CI checks out the exact host repository/revision from
`sdk.lock.json` into `.artifacts/lithe-core`; it never follows a moving branch.
For the same local procedure, clone the pinned host once (network required):

```sh
gh repo clone 1lck/Lithe-IDEA .artifacts/lithe-core -- --filter=blob:none --no-checkout
git -C .artifacts/lithe-core sparse-checkout set rust shared
git -C .artifacts/lithe-core checkout --detach "$(node -p 'require("./sdk.lock.json").source.revision')"
node scripts/prepare-core.mjs
LITHE_CARGO_INTEGRATION=1 node scripts/test.mjs
```

Cargo downloads the host's locked Rust dependencies on the first build; only
the tiny Cargo fixture runs offline. Preparation rejects a different revision,
origin or tracked modifications, builds with `--locked`, and records bridge
and binary hashes. `.artifacts/core-target` is private mutable build state for
this checkout; it is not a shared worktree cache and never enters the plugin ZIP.
The copied example in the disposable host checkout contains only the public API
call; Cargo-specific assertions, manifests and golden models remain here.

The three Core compatibility tests cover install review and capability refusal,
outermost workspace detection/model decoding, and task/test argument selection.
The packaged-provider test passes the real reply through Core and executes
Core-generated build/check/test/run/clean plans, including diagnostic decoding.
It does not substitute hand-written Cargo commands for the host plans.
HTML, per-test timing, JUnit and logs are written to `.artifacts/test-stability/`
and uploaded by CI. Default unit runs explicitly skip host/Cargo integration;
both CI and release verification enable it.

The archive and its SHA-256 sidecar are written to `dist/`; the unpacked package
is `dist/io.github.lithe-idea.cargo-build/`. The archive serves both Apple Silicon
and Intel Macs. CI builds on Linux to conserve native runner usage; the local
integration suite was also run on macOS.

The zero-dependency Node SDK and test helpers are vendored at the exact source
revision in `sdk.lock.json`. Packaging refuses changed/unpinned vendor files and
symbolic links. To update the SDK, copy the upstream files and deliberately
update the source revision and every SHA-256; do not download anything at runtime.
The main Lithe repository retains generic plugin contract tests. This repository
owns Cargo-specific compatibility tests and uses the same host pin as the SDK;
updating that pin deliberately tests a new supported host baseline. A fixed
baseline does not by itself detect regressions on future Lithe preview commits.

## Runtime and build ownership

The provider starts Cargo only when the user loads the model, using
`cargo metadata --format-version 1 --no-deps`. It uses the host's selected tool
path when supplied. The SDK owns request cancellation and subprocess cleanup.
The installed plugin and Lithe.app stay read-only; the integration test compares
the package's complete file listing and SHA-256 hashes before and after use.

Cargo's user cache, Cargo.lock and target directory remain owned by Cargo and
the user's project configuration. This plugin creates no extra runtime cache.
`dist/`, packaging staging, the pinned host checkout, Core compilation and
`.artifacts/` test reports belong to one checkout
and must not be copied as shared build caches. Packaging removes its own staging
on success/failure; developers own final artifact cleanup. No installation step
runs in the read-only plugin package.

## Release

Update `plugin.json`, commit, and push `v<version>` matching the manifest.
The release workflow verifies the SDK, runs the offline fixture integration,
builds the ZIP and SHA-256, and publishes a **pre-release**. Native UI acceptance
must be completed before changing the workflow to publish stable releases.
Published ZIP bytes are immutable: fixes require a new version.

The Store index records the repository URL, API requirements, release URL and
archive SHA-256. First inclusion and pre-releases use a reviewed Store pull request.
