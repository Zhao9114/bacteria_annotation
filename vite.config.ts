import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built site works from a GitHub Pages subpath.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
