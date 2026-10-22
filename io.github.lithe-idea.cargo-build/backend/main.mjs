// Cargo build provider. Package and lifecycle ownership: README.md.
import { createBackend, PluginError } from './vendor/lithe-plugin-sdk/index.mjs';
import { registerCargoProvider } from './provider.mjs';

const backend = createBackend({ name: 'cargo-build', version: '0.1.1' });
registerCargoProvider(backend, PluginError);
await backend.listen();
