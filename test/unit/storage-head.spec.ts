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
  it("returns actual object metadata", async () => {
    send.mockResolvedValue({ ContentLength: 123, ContentType: "image/png" });
    expect(await storage.headObject("key")).toEqual({
      contentLength: 123,
      contentType: "image/png",
    });
  });
  it.each([
    { name: "NotFound" },
    { name: "NoSuchKey" },
    { $metadata: { httpStatusCode: 404 } },
  ])("returns null only for absence: %p", async (error) => {
    send.mockRejectedValue(error);
    expect(await storage.headObject("key")).toBeNull();
  });
  it.each([
    { $metadata: { httpStatusCode: 403 } },
    { $metadata: { httpStatusCode: 500 } },
    new Error("network error"),
  ])("propagates credentials/upstream/network failure: %p", async (error) => {
    send.mockRejectedValue(error);
    await expect(storage.headObject("key")).rejects.toMatchObject({
      status: 500,
    });
  });
});
