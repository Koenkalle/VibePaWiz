import { defineConfig } from 'vitest/config';

// `base` matches the GitHub Pages project path (https://<user>.github.io/VibePaWiz/).
// Override with VPW_BASE when deploying elsewhere (e.g. a custom domain → "/").
export default defineConfig({
  base: process.env.VPW_BASE ?? '/VibePaWiz/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
