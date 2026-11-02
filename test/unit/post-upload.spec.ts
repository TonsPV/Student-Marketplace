/**
 * MODULE: POSTS (VÒNG ĐỜI TIN ĐĂNG)
 *
 * WORD TEST CASES:
 * - TC-PU-01: Cho phép: only own message and post uploads
 * - TC-PU-02: Từ chối: invalid or foreign key before HEAD: posts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
 * - TC-PU-03: Từ chối: invalid or foreign key before HEAD: messages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
 * - TC-PU-04: Từ chối: invalid or foreign key before HEAD: posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.svg
 * - TC-PU-05: Từ chối: invalid or foreign key before HEAD: https://example.com/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
 * - TC-PU-06: Từ chối: invalid or foreign key before HEAD: posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png/../x
 * - TC-PU-07: Từ chối: invalid or foreign key before HEAD: POSTS/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC.PNG
 * - TC-PU-08: Chấp nhận: valid matching metadata and normalizes principal UUID
 * - TC-PU-09: Từ chối: missing or invalid object: null
 * - TC-PU-10: Từ chối: missing or invalid object: {"contentLength": 68, "contentType": "image/jpeg"}
 * - TC-PU-11: Từ chối: missing or invalid object: {"contentLength": 68, "contentType": undefined}
 * - TC-PU-12: Từ chối: missing or invalid object: {"contentLength": 0, "contentType": "image/png"}
 * - TC-PU-13: Từ chối: missing or invalid object: {"contentLength": 1025, "contentType": "image/png"}
 * - TC-PU-14: Từ chối: missing or invalid object: {"contentLength": 1.5, "contentType": "image/png"}
 * - TC-PU-15: Truyền lỗi lên: upstream failures
 */

import "reflect-metadata";
import { StorageService } from "../../src/modules/storage/storage.service";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = `posts/${OWNER}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;

describe("post upload keys, metadata and CASL", () => {
  const authorization = new AuthorizationService(new CaslAbilityFactory());
  const context = authorization.createAuthenticatedContext({
    id: OWNER,
    email: "owner@example.com",
    fullName: "Owner",
    isAdmin: false,
  });
  let storage: StorageService;
  let head: jest.SpyInstance;
  beforeEach(() => {
    storage = new StorageService(
      {
        endpointUrl: "https://test.r2.cloudflarestorage.com",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucketName: "test",
      },
      {
        maxFileSizeBytes: 1024,
        putSignedUrlExpiresSec: 300,
        getSignedUrlExpiresSec: 900,
      },
      authorization,
    );
    head = jest
      .spyOn(storage, "headObject")
      .mockResolvedValue({ contentLength: 68, contentType: "image/png" });
  });
  afterEach(() => jest.restoreAllMocks());

  // [WORD-TC: TC-PU-01]
  // Chức năng: Cho phép: only own message and post uploads
  it("[TC-PU-01] Cho phép: only own message and post uploads", () => {
    for (const purpose of ["post", "message", "avatar"]) {
      expect(() =>
        authorization.assertCreate(context, "Upload", {
          ownerId: OWNER,
          purpose,
        }),
      ).not.toThrow();
      expect(() =>
        authorization.assertCreate(context, "Upload", {
          ownerId: OTHER,
          purpose,
        }),
      ).toThrow();
      expect(() =>
        authorization.assertCreate(
          authorization.createGuestContext(),
          "Upload",
          { ownerId: OWNER, purpose },
        ),
      ).toThrow();
    }
    expect(() =>
      authorization.assertCreate(context, "Upload", {
        ownerId: OWNER,
        purpose: "unsupported",
      }),
    ).toThrow();
  });
  // [WORD-TC: TC-PU-02]
  // Chức năng: Từ chối: invalid or foreign key before HEAD: posts/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
  // [WORD-TC: TC-PU-03]
  // Chức năng: Từ chối: invalid or foreign key before HEAD: messages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
  // [WORD-TC: TC-PU-04]
  // Chức năng: Từ chối: invalid or foreign key before HEAD: posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.svg
  // [WORD-TC: TC-PU-05]
  // Chức năng: Từ chối: invalid or foreign key before HEAD: https://example.com/posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png
  // [WORD-TC: TC-PU-06]
  // Chức năng: Từ chối: invalid or foreign key before HEAD: posts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png/../x
  // [WORD-TC: TC-PU-07]
  // Chức năng: Từ chối: invalid or foreign key before HEAD: POSTS/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC.PNG
  it.each([
    KEY.replace(OWNER, OTHER),
    KEY.replace("posts/", "messages/"),
    KEY.replace(".png", ".svg"),
    `https://example.com/${KEY}`,
    `${KEY}/../x`,
    KEY.toUpperCase(),
  ])("[TC-PU] Từ chối storage key sai định dạng hoặc của người khác: %s", async (key) => {
    await expect(storage.verifyPostImage(key, OWNER)).rejects.toMatchObject({
      status: 400,
    });
    expect(head).not.toHaveBeenCalled();
  });
  // [WORD-TC: TC-PU-08]
  // Chức năng: Chấp nhận: valid matching metadata and normalizes principal UUID
  it("[TC-PU-08] Chấp nhận: valid matching metadata and normalizes principal UUID", async () => {
    await expect(
      storage.verifyPostImage(KEY, OWNER.toUpperCase()),
    ).resolves.toBeUndefined();
    expect(head).toHaveBeenCalledWith(KEY);
  });
  // [WORD-TC: TC-PU-09]
  // Chức năng: Từ chối: missing or invalid object: null
  // [WORD-TC: TC-PU-10]
  // Chức năng: Từ chối: missing or invalid object: {"contentLength": 68, "contentType": "image/jpeg"}
  // [WORD-TC: TC-PU-11]
  // Chức năng: Từ chối: missing or invalid object: {"contentLength": 68, "contentType": undefined}
  // [WORD-TC: TC-PU-12]
  // Chức năng: Từ chối: missing or invalid object: {"contentLength": 0, "contentType": "image/png"}
  // [WORD-TC: TC-PU-13]
  // Chức năng: Từ chối: missing or invalid object: {"contentLength": 1025, "contentType": "image/png"}
  // [WORD-TC: TC-PU-14]
  // Chức năng: Từ chối: missing or invalid object: {"contentLength": 1.5, "contentType": "image/png"}
  it.each([
    null,
    { contentLength: 68, contentType: "image/jpeg" },
    { contentLength: 68, contentType: undefined },
    { contentLength: 0, contentType: "image/png" },
    { contentLength: 1025, contentType: "image/png" },
    { contentLength: 1.5, contentType: "image/png" },
  ])("[TC-PU] Từ chối object ảnh không tồn tại hoặc metadata không hợp lệ: %p", async (metadata) => {
    head.mockResolvedValue(metadata);
    await expect(storage.verifyPostImage(KEY, OWNER)).rejects.toMatchObject({
      status: 400,
    });
  });
  // [WORD-TC: TC-PU-15]
  // Chức năng: Truyền lỗi lên: upstream failures
  it("[TC-PU-15] Truyền lỗi lên: upstream failures", async () => {
    const error = new Error("R2 unavailable");
    head.mockRejectedValue(error);
    await expect(storage.verifyPostImage(KEY, OWNER)).rejects.toBe(error);
  });
});
