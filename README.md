# Cargo for Lithe (macOS)

Cargo is a community build plugin for Lithe. It uses Lithe's native Cargo
tool window and Build Output to build, check, test, clean, and run Rust projects.

**0.1.3 is a preview release.** Native disk-installation and full UI acceptance
are still pending. Automated integration and host compatibility run in this
repository's CI.
The plugin requires a Lithe preview with API 3 `buildSystems: 1`, `executableResolution: 1`, `settings: 2`,
`buildProviders: 1`, `serverProcess: 1` and structured plugin diagnostics (`litheLogging: 1`).
Stable Lithe 0.6.7 does not offer `litheLogging: 1` and cannot start 0.1.3. Windows is not supported yet.
It uses the released Node.js SDK 0.3.0, pinned by tag and SHA-256 in `sdk.lock.json`;
that SDK reports structured diagnostics and so needs a Lithe build offering `litheLogging: 1`.

## Install

Install Rust/Cargo 1.70+ and Node.js 20.3+ first. Node runs the metadata provider;
Cargo and rust-analyzer are not bundled. Existing Rust language intelligence
continues to use Lithe's Rust language service.

Download `cargo-build-0.1.3-darwin.zip` from [Releases](https://github.com/Lithe-IDEA/lithe-plugin-cargo/releases).
Hosts without `litheLogging: 1` can keep using the 0.1.1 preview, which keeps its older host requirements.
In Lithe, choose Settings → Plugins → Install from Disk, select the ZIP,
review Cargo/Node and its permissions, and restart. Enable Cargo, open the
Cargo workspace root, then open the Cargo tool window and load the project model.
0.1.3 is not listed in [Lithe Store](https://github.com/Lithe-IDEA/Lithe-store) yet: the Store cannot
tell stable hosts without `litheLogging: 1` apart, so install it from disk.

## Cargo path

Settings → Plugins → Cargo → Settings contains **Cargo 路径** with a native
file picker. It also appears in Build, Execution, Deployment → Cargo. Leave it
empty for automatic discovery, or select the Cargo executable (not rustc/rustup).
Saving reloads the model; metadata, build, check, test, run and clean use that
same executable. A missing, non-executable or too-old selection fails visibly
instead of silently choosing a different Cargo installation. The executable's
parent directory is placed first on PATH for companion tools.

Version 0.1.3 requires a preview host with `buildSystems: 1`, `executableResolution: 1`, `settings: 2` and `litheLogging: 1`.
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

## Diagnostic logs

Version 0.1.3 requires a host offering `litheLogging: 1`. The vendored official
Node SDK 0.3.0 sends typed `lithe/log` notifications to the host's v2 catalog and
writer, in the current session's
`plugins/io.github.lithe-idea.cargo-build/host` channel. The SDK records one
INFO terminal on a successful metadata request and one ERROR on a failed
request, with monotonic duration and a controlled failure code. Cancellation
does not become an error. The provider does not log and throw the same failure
twice, and does not copy metadata JSON, Cargo stderr, source, environment values
or raw exceptions into logs.

Build, check, test and run process outcomes use the host's `run` channel;
their output stays in Build Output. Use Lithe's log window and diagnostic
export for host evidence. No plugin writer, log directory or idle task is
added. The vendored SDK files are byte-identical to the released Node.js SDK
0.3.0 archive, as pinned by `sdk.lock.json`. Windows still uses v1 logging; no
Windows v2 acceptance is claimed.

## Develop and verify

Requires Node 20.3+, `zip`, and Cargo for integration tests. Unit tests and
packaging need no npm installation, network service or adjacent Lithe checkout:

```sh
node scripts/verify-sdk.mjs
node scripts/test.mjs
node scripts/package.mjs
```

`node scripts/verify-sdk.mjs --download` additionally downloads the released SDK
archive, checks its SHA-256 against `sdk.lock.json` and requires every vendored
SDK file to match the archive byte for byte. CI and release verification run it.

Full integration compiles a test-only bridge to Lithe's public `execute_json`
API. CI uses the host repository and `preview` ref in `sdk.lock.json.coreSource`,
then records the exact resolved commit and source digest. See **Core integration
source** below for verified local working-tree preparation and the complete command.

Cargo downloads the host's locked Rust dependencies on the first build;
the Cargo fixture itself runs offline. `.artifacts/core-target` contains only
private test build state and never enters the plugin ZIP. The harness links
the public Core library without copying files into the source checkout.

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

The zero-dependency Node SDK is the released Node.js SDK 0.3.0 from
`Lithe-IDEA/lithe-plugin-docs`: `sdk.lock.json.sdk` pins its tag
`sdk-node-v0.3.0`, commit, release asset URL and SHA-256, and vendors the files
unchanged. The SDK test harness is not part of the release asset; it is pinned
to the same tagged commit. Test-support helpers keep their own source revision
(`testSupport`). Every vendor file has an exact SHA-256; packaging refuses
changed or unpinned inputs and symbolic links. The separate `coreSource` chooses
the integration host preview, so SDK provenance is never confused with the
host's current source identity. No SDK or runtime is downloaded when the
installed plugin starts.

To update the SDK, take a newer released Node.js SDK archive, replace the
vendored files with its contents (no local edits), update the `sdk` release
fields and every file hash in `sdk.lock.json`, and run
`node scripts/verify-sdk.mjs --download`.

## Runtime and build ownership

The provider starts Cargo only when the user loads the model, using
`cargo metadata --format-version 1 --no-deps`. It uses the host's selected tool
path when supplied. The SDK owns request cancellation and subprocess cleanup.
The installed plugin and Lithe.app stay read-only; the integration test compares
the package's complete file listing and SHA-256 hashes before and after use.

Cargo's user cache, Cargo.lock and target directory remain owned by Cargo and
the user's project configuration. This plugin creates no extra runtime cache.
`dist/`, packaging staging, the selected host checkout, Core compilation and
`.artifacts/` test reports belong to one checkout
and must not be copied as shared build caches. Packaging removes its own staging
on success/failure; developers own final artifact cleanup. No installation step
runs in the read-only plugin package.

## Release

Update `plugin.json`, commit, and push `v<version>` matching the manifest.
The release workflow verifies the SDK (including the released archive download),
runs the offline fixture integration, builds the ZIP and SHA-256, and publishes a
**pre-release**, then reads the release back and corrects the pre-release flag if
GitHub did not apply it. Native UI acceptance
must be completed before changing the workflow to publish stable releases.
Published ZIP bytes are immutable: fixes require a new version.

The Store index records the repository URL, API requirements, release URL and
archive SHA-256. First inclusion and pre-releases use a reviewed Store pull request.

Version 0.1.2 migrates custom Cargo selection to the shared ordered executable
candidates. Published 0.1.0 to 0.1.2 preview archives remain immutable. A compatible
host must advertise `executableResolution: 1`; the setting is a candidate ahead
of automatic PATH discovery, with empty values skipped and explicit failures
reported by the host. Maven/Gradle-style automatic candidates need no path setting.

## Core integration source

CI and release verification explicitly check out `sdk.lock.json.coreSource.ref`
(`preview`) from the verified host repository. The host must offer
`litheLogging: 1`; preparation rejects a host missing the typed operation
catalog rather than attempting an old-protocol fallback. It records the resolved
commit and exact source SHA-256; this moving test ref is not presented as a
pinned release artifact. SDK vendor hashes and the test-support source remain
independently pinned.

Local validation can select a particular real host checkout and revision:

```sh
node scripts/prepare-core.mjs --source /path/to/Lithe-IDEA --ref HEAD --working-tree --target-dir /path/to/Lithe-IDEA/rust/target
LITHE_CARGO_INTEGRATION=1 node scripts/test.mjs
```

`--working-tree` is a deliberate opt-in for local unpublished host changes;
without it, dirty sources are rejected. The origin must still match the host
repository and HEAD must resolve to the selected ref. The source remains
unchanged: a test-only Rust executable links the built Core library in the
plugin's private `.artifacts/core-target/`. Preparation records tracked and
untracked `rust/` and `shared/` bytes, the harness and executable hashes;
tests reject any drift after preparation. A caller may reuse an existing
Cargo target with `--target-dir`, but never shares plugin state or log files.
