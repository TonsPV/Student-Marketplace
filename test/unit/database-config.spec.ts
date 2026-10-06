import { databaseOptions } from "../../src/config/database.config";

describe("database synchronization safety", () => {
  it("defaults to migrations, even when development", () => {
    expect(databaseOptions({ NODE_ENV: "development" }).synchronize).toBe(
      false,
    );
  });
  it("allows explicit development opt-in", () => {
    expect(
      databaseOptions({ NODE_ENV: "development", POSTGRES_SYNCHRONIZE: "true" })
        .synchronize,
    ).toBe(true);
  });
  it("refuses synchronize outside development/test", () => {
    expect(() =>
      databaseOptions({ NODE_ENV: "production", POSTGRES_SYNCHRONIZE: "true" }),
    ).toThrow("requires NODE_ENV");
    expect(() => databaseOptions({ POSTGRES_SYNCHRONIZE: "true" })).toThrow(
      "requires NODE_ENV",
    );
  });
  it("rejects unsafe schema identifiers", () => {
    expect(() =>
      databaseOptions({ POSTGRES_SCHEMA: "public; DROP SCHEMA public" }),
    ).toThrow("Invalid POSTGRES_SCHEMA");
  });
});
