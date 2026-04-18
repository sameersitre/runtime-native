import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  external: ['react', 'react-native', '@flotrace/runtime-core'],
  esbuildOptions(options) {
    options.external = ['react', 'react/jsx-runtime', 'react-native', '@flotrace/runtime-core'];
  },
});
