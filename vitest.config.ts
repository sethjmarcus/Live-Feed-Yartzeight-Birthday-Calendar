import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Run in Israel time: catches all-day events shifting a day when the server isn't on UTC.
    env: { TZ: 'Asia/Jerusalem' },
    testTimeout: 20_000,
  },
});
