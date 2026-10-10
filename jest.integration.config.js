/**
 * Jest config for PostgreSQL integration tests (needs isolated test DB).
 * Fails fast with a clear message when TEST_DATABASE_URL / POSTGRES_* is missing.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test/integration"],
  testMatch: ["**/*.spec.ts"],
  testTimeout: 120000,
  maxWorkers: 1,
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
  transform: {
    "^.+\\.[tj]s$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: ["node_modules/(?!@nestjs/jwt/)"],
};
