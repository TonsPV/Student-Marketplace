/** Jest config for pure unit tests (no DB, no R2 network). */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test/unit"],
  testMatch: ["**/*.spec.ts"],
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
};
