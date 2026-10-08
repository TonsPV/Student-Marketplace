import { UnauthorizedException } from "@nestjs/common";
import type { Repository } from "typeorm";
import { AuthPrincipalService } from "../../src/common/auth-principal/auth-principal.service";
import type { UserEntity } from "../../src/modules/user/user.entity";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("DB-current principal and strict verified claims", () => {
  const findOne = jest.fn();
  const service = new AuthPrincipalService({
    findOne,
  } as unknown as Repository<UserEntity>);
  beforeEach(() => findOne.mockReset());
  it.each([undefined, NaN, Infinity, -1, 0, Number.MAX_VALUE])(
    "rejects missing, expired or non-finite expiry: %p",
    (exp) => {
      expect(() => service.validateVerifiedClaims({ id: ID, exp })).toThrow(
        UnauthorizedException,
      );
    },
  );
  it.each([null, "wrong-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"])(
    "rejects mismatching subject: %p",
    (sub) => {
      expect(() =>
        service.validateVerifiedClaims({
          id: ID,
          exp: Date.now() / 1000 + 60,
          sub,
        }),
      ).toThrow(UnauthorizedException);
    },
  );
  it("normalizes ID and allows an omitted subject", () => {
    expect(
      service.validateVerifiedClaims({
        id: ID.toUpperCase(),
        exp: Date.now() / 1000 + 60,
      }).id,
    ).toBe(ID);
  });
  it("ignores stale token role/name claims and returns DB principal", async () => {
    findOne.mockResolvedValue({
      id: ID,
      email: "db@example.com",
      fullName: "DB name",
      isAdmin: false,
      isLocked: false,
    });
    expect(
      await service.resolveFromVerifiedClaims({
        id: ID,
        exp: Date.now() / 1000 + 60,
        email: "stale@example.com",
      }),
    ).toEqual({
      id: ID,
      email: "db@example.com",
      fullName: "DB name",
      isAdmin: false,
    });
  });
  it.each([null, { id: ID, isLocked: true }])(
    "denies missing/deleted or locked DB accounts",
    async (account) => {
      findOne.mockResolvedValue(account);
      await expect(service.resolveActive(ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );
  it("propagates DB failures rather than presenting them as an invalid account", async () => {
    const error = new Error("DB unavailable");
    findOne.mockRejectedValue(error);
    await expect(service.resolveActive(ID)).rejects.toBe(error);
  });
});
