/**
 * MODULE: AUTHENTICATION & PHIÊN ĐĂNG NHẬP
 *
 * WORD TEST CASES:
 * - TC-AUTH-01: Từ chối: missing, expired or non-finite expiry: undefined
 * - TC-AUTH-02: Từ chối: missing, expired or non-finite expiry: NaN
 * - TC-AUTH-03: Từ chối: missing, expired or non-finite expiry: Infinity
 * - TC-AUTH-04: Từ chối: missing, expired or non-finite expiry: -1
 * - TC-AUTH-05: Từ chối: missing, expired or non-finite expiry: 0
 * - TC-AUTH-06: Từ chối: missing, expired or non-finite expiry: 1.7976931348623157e+308
 * - TC-AUTH-07: Từ chối: mismatching subject: null
 * - TC-AUTH-08: Từ chối: mismatching subject: "wrong-id"
 * - TC-AUTH-09: Từ chối: mismatching subject: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
 * - TC-AUTH-10: ID được normalize về chữ thường và chấp nhận thiếu subject (sub)
 * - TC-AUTH-11: Bỏ qua claim cũ trong token, trả về principal lấy từ DB
 * - TC-AUTH-12: Từ chối tài khoản DB không tồn tại/đã xóa hoặc đang bị khóa (Unauthorized)
 * - TC-AUTH-13: Từ chối tài khoản DB không tồn tại/đã xóa hoặc đang bị khóa (Unauthorized)
 * - TC-AUTH-14: Lỗi DB được truyền lên nguyên trạng, không bị biến thành 'tài khoản không hợp lệ'
 */

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
  // [WORD-TC: TC-AUTH-01]
  // Chức năng: Từ chối: missing, expired or non-finite expiry: undefined
  // [WORD-TC: TC-AUTH-02]
  // Chức năng: Từ chối: missing, expired or non-finite expiry: NaN
  // [WORD-TC: TC-AUTH-03]
  // Chức năng: Từ chối: missing, expired or non-finite expiry: Infinity
  // [WORD-TC: TC-AUTH-04]
  // Chức năng: Từ chối: missing, expired or non-finite expiry: -1
  // [WORD-TC: TC-AUTH-05]
  // Chức năng: Từ chối: missing, expired or non-finite expiry: 0
  // [WORD-TC: TC-AUTH-06]
  // Chức năng: Từ chối: missing, expired or non-finite expiry: 1.7976931348623157e+308
  it.each([undefined, NaN, Infinity, -1, 0, Number.MAX_VALUE])(
    "[TC-AUTH] Từ chối token thiếu, hết hạn hoặc thời hạn không hợp lệ: %p",
    (exp) => {
      expect(() => service.validateVerifiedClaims({ id: ID, exp })).toThrow(
        UnauthorizedException,
      );
    },
  );
  // [WORD-TC: TC-AUTH-07]
  // Chức năng: Từ chối: mismatching subject: null
  // [WORD-TC: TC-AUTH-08]
  // Chức năng: Từ chối: mismatching subject: "wrong-id"
  // [WORD-TC: TC-AUTH-09]
  // Chức năng: Từ chối: mismatching subject: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  it.each([null, "wrong-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"])(
    "[TC-AUTH] Từ chối subject (sub) không khớp với user id: %p",
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
  // [WORD-TC: TC-AUTH-10]
  // Chức năng: ID được normalize về chữ thường và chấp nhận thiếu subject (sub)
  it("[TC-AUTH-10] ID được normalize về chữ thường và chấp nhận thiếu subject (sub)", () => {
    expect(
      service.validateVerifiedClaims({
        id: ID.toUpperCase(),
        exp: Date.now() / 1000 + 60,
      }).id,
    ).toBe(ID);
  });
  // [WORD-TC: TC-AUTH-11]
  // Chức năng: Bỏ qua claim cũ trong token, trả về principal lấy từ DB
  it("[TC-AUTH-11] Bỏ qua claim cũ trong token, trả về principal lấy từ DB", async () => {
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
      hasLocation: false,
    });
  });
  // [WORD-TC: TC-AUTH-12]
  // Chức năng: Từ chối tài khoản DB không tồn tại/đã xóa hoặc đang bị khóa (Unauthorized)
  // [WORD-TC: TC-AUTH-13]
  // Chức năng: Từ chối tài khoản DB không tồn tại/đã xóa hoặc đang bị khóa (Unauthorized)
  it.each([null, { id: ID, isLocked: true }])(
    "[TC-AUTH] Từ chối tài khoản DB không tồn tại, đã xóa hoặc bị khóa",
    async (account) => {
      findOne.mockResolvedValue(account);
      await expect(service.resolveActive(ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );
  // [WORD-TC: TC-AUTH-14]
  // Chức năng: Lỗi DB được truyền lên nguyên trạng, không bị biến thành 'tài khoản không hợp lệ'
  it("[TC-AUTH-14] Lỗi DB được truyền lên nguyên trạng, không bị biến thành 'tài khoản không hợp lệ'", async () => {
    const error = new Error("DB unavailable");
    findOne.mockRejectedValue(error);
    await expect(service.resolveActive(ID)).rejects.toBe(error);
  });
});
