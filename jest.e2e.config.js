/**
 * Jest config for HTTP + WebSocket E2E tests (needs running API + test DB).
 * See test/e2e/README for required env.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test/e2e"],
  testMatch: ["**/*.spec.ts"],
  testTimeout: 120000,
  maxWorkers: 1,
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
  // Nest v12 auxiliary packages are ESM; compile their JS for Jest 29's CJS runtime.
  transform: {
    "^.+\\.[tj]s$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: [
    "node_modules/(?!@nestjs/(jwt|passport|schedule)/)",
  ],
};
