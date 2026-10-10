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

  it("allows only own message and post uploads", () => {
    for (const purpose of ["post", "message"]) {
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
        purpose: "avatar",
      }),
    ).toThrow();
  });
  it.each([
    KEY.replace(OWNER, OTHER),
    KEY.replace("posts/", "messages/"),
    KEY.replace(".png", ".svg"),
    `https://example.com/${KEY}`,
    `${KEY}/../x`,
    KEY.toUpperCase(),
  ])("rejects invalid or foreign key before HEAD: %s", async (key) => {
    await expect(storage.verifyPostImage(key, OWNER)).rejects.toMatchObject({
      status: 400,
    });
    expect(head).not.toHaveBeenCalled();
  });
  it("accepts valid matching metadata and normalizes principal UUID", async () => {
    await expect(
      storage.verifyPostImage(KEY, OWNER.toUpperCase()),
    ).resolves.toBeUndefined();
    expect(head).toHaveBeenCalledWith(KEY);
  });
  it.each([
    null,
    { contentLength: 68, contentType: "image/jpeg" },
    { contentLength: 68, contentType: undefined },
    { contentLength: 0, contentType: "image/png" },
    { contentLength: 1025, contentType: "image/png" },
    { contentLength: 1.5, contentType: "image/png" },
  ])("rejects missing or invalid object: %p", async (metadata) => {
    head.mockResolvedValue(metadata);
    await expect(storage.verifyPostImage(KEY, OWNER)).rejects.toMatchObject({
      status: 400,
    });
  });
  it("propagates upstream failures", async () => {
    const error = new Error("R2 unavailable");
    head.mockRejectedValue(error);
    await expect(storage.verifyPostImage(KEY, OWNER)).rejects.toBe(error);
  });
});
