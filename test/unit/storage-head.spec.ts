/**
 * MODULE: STORAGE & CẤU HÌNH
 *
 * WORD TEST CASES:
 * - TC-SHEAD-01: Trả về metadata thật của object (contentLength, contentType)
 * - TC-SHEAD-02: Trả về: null only for absence: {"name": "NotFound"}
 * - TC-SHEAD-03: Trả về: null only for absence: {"name": "NoSuchKey"}
 * - TC-SHEAD-04: Trả về: null only for absence: {"$metadata": [Object]}
 * - TC-SHEAD-05: Truyền lỗi lên: credentials/upstream/network failure: {"$metadata": [Object]}
 * - TC-SHEAD-06: Truyền lỗi lên: credentials/upstream/network failure: {"$metadata": [Object]}
 * - TC-SHEAD-07: Truyền lỗi lên: credentials/upstream/network failure: [Error: network error]
 */

import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { StorageService } from "../../src/modules/storage/storage.service";

describe("R2 HEAD failure classification (S6)", () => {
  let storage: StorageService;
  const send = jest.fn();
  beforeEach(() => {
    send.mockReset();
    storage = new StorageService(
      {
        endpointUrl: "https://test.r2.cloudflarestorage.com",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucketName: "test",
      },
      {
        maxFileSizeBytes: 5242880,
        putSignedUrlExpiresSec: 300,
        getSignedUrlExpiresSec: 900,
      },
      new AuthorizationService(new CaslAbilityFactory()),
    );
    Object.defineProperty(storage, "client", { value: { send } });
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  // [WORD-TC: TC-SHEAD-01]
  // Chức năng: Trả về metadata thật của object (contentLength, contentType)
  it("[TC-SHEAD-01] Trả về metadata thật của object (contentLength, contentType)", async () => {
    send.mockResolvedValue({ ContentLength: 123, ContentType: "image/png" });
    expect(await storage.headObject("key")).toEqual({
      contentLength: 123,
      contentType: "image/png",
    });
  });
  // [WORD-TC: TC-SHEAD-02]
  // Chức năng: Trả về: null only for absence: {"name": "NotFound"}
  // [WORD-TC: TC-SHEAD-03]
  // Chức năng: Trả về: null only for absence: {"name": "NoSuchKey"}
  // [WORD-TC: TC-SHEAD-04]
  // Chức năng: Trả về: null only for absence: {"$metadata": [Object]}
  it.each([
    { name: "NotFound" },
    { name: "NoSuchKey" },
    { $metadata: { httpStatusCode: 404 } },
  ])("[TC-SHEAD] Chỉ trả về null khi đối tượng không tồn tại (NotFound/NoSuchKey): %p", async (error) => {
    send.mockRejectedValue(error);
    expect(await storage.headObject("key")).toBeNull();
  });
  // [WORD-TC: TC-SHEAD-05]
  // Chức năng: Truyền lỗi lên: credentials/upstream/network failure: {"$metadata": [Object]}
  // [WORD-TC: TC-SHEAD-06]
  // Chức năng: Truyền lỗi lên: credentials/upstream/network failure: {"$metadata": [Object]}
  // [WORD-TC: TC-SHEAD-07]
  // Chức năng: Truyền lỗi lên: credentials/upstream/network failure: [Error: network error]
  it.each([
    { $metadata: { httpStatusCode: 403 } },
    { $metadata: { httpStatusCode: 500 } },
    new Error("network error"),
  ])("[TC-SHEAD] Ném lỗi trực tiếp khi gặp lỗi credentials, upstream hoặc mạng R2: %p", async (error) => {
    send.mockRejectedValue(error);
    await expect(storage.headObject("key")).rejects.toMatchObject({
      status: 500,
    });
  });
});
