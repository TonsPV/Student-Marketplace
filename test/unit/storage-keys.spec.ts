import "reflect-metadata";
import { StorageService } from "src/modules/storage/storage.service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OBJ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("StorageService key helpers (U3/S-key)", () => {
  it("key đúng format + đúng owner → owned", () => {
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        `messages/${USER}/${OBJ}.jpg`,
        USER,
      ),
    ).toBe(true);
  });

  it("sai owner / sai purpose / sai regex → 400 ở service (không gọi storage)", () => {
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    // Sai owner
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        `messages/${other}/${OBJ}.jpg`,
        USER,
      ),
    ).toBe(false);
    // Sai purpose/prefix
    expect(
      StorageService.isMessageImageKeyOwnedBy(`posts/${USER}/${OBJ}.jpg`, USER),
    ).toBe(false);
    // Đếm ký tự hex thay vì UUID canonical
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        "messages/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe(false);
    // Path traversal / external URL / encoded separator
    for (const evil of [
      `messages/${USER}/../x.jpg`,
      `messages/${USER}/${OBJ}.jpg/../../x`,
      `https://evil.example/messages/${USER}/${OBJ}.jpg`,
      `messages/${USER}%2F${OBJ}.jpg`,
      `messages/${USER}/${OBJ}.exe`,
      `messages/${USER}/${OBJ}.JPG`,
      "",
    ]) {
      expect(StorageService.isMessageImageKey(evil)).toBe(false);
      expect(StorageService.isMessageImageKeyOwnedBy(evil, USER)).toBe(false);
    }
    expect(StorageService.isMessageImageKeyOwnedBy(null, USER)).toBe(false);
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        `messages/${USER}/${OBJ}.jpg`,
        other,
      ),
    ).toBe(false);
  });

  it("owner normalize case-insensitive như JWT userId", () => {
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        `messages/${USER}/${OBJ}.png`,
        USER.toUpperCase(),
      ),
    ).toBe(true);
  });

  it("extension khớp contentType whitelist", () => {
    expect(StorageService.extensionForContentType("image/jpeg")).toBe("jpg");
    expect(StorageService.extensionForContentType("image/png")).toBe("png");
    expect(StorageService.extensionForContentType("image/webp")).toBe("webp");
    expect(StorageService.extensionForContentType("image/gif")).toBeNull();
    expect(StorageService.extensionForContentType("text/html")).toBeNull();
  });
});
