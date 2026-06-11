import { defineConfig } from 'vitest/config';

// Relative base so the built site works wherever it's served — a user/org page
// (https://<user>.github.io/), a project page (…/VibePaWiz/), or a custom domain —
// without hardcoding the path. Override with VPW_BASE only if you need an absolute base.
export default defineConfig({
  base: process.env.VPW_BASE ?? './',
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
