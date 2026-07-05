import { defineConfig } from "vitest/config";

// Package-local config so `npm run test -w apps/desktop-backend` scopes to this
// package's own tests (the root vitest.config.ts still picks them up under its
// `apps/**` glob when the whole suite runs).
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "node",
  },
});
