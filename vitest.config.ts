import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom supplies localStorage for the library tests. The units under test
    // are otherwise DOM-free — canvas-backed code is covered by the e2e suite,
    // since jsdom has no 2D context.
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
