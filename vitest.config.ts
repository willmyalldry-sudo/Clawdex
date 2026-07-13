import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/worker/src/**/*.test.ts"],
    environment: "node",
    coverage: { reporter: ["text", "json", "html"] },
  },
});
