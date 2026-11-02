/**
 * MODULE: STORAGE & CẤU HÌNH
 *
 * WORD TEST CASES:
 * - TC-SKEY-01: Key đúng định dạng + đúng chủ sở hữu → được coi là owned
 * - TC-SKEY-02: Sai owner/purpose/regex → lỗi 400 tại service, không gọi storage
 * - TC-SKEY-03: Owner được chuẩn hóa case-insensitive giống JWT userId
 * - TC-SKEY-04: Extension khớp whitelist contentType
 */

import "reflect-metadata";
import { StorageService } from "src/modules/storage/storage.service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OBJ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("StorageService key helpers (U3/S-key)", () => {
  // [WORD-TC: TC-SKEY-01]
  // Chức năng: Key đúng định dạng + đúng chủ sở hữu → được coi là owned
  it("[TC-SKEY-01] Key đúng định dạng + đúng chủ sở hữu → được coi là owned", () => {
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        `messages/${USER}/${OBJ}.jpg`,
        USER,
      ),
    ).toBe(true);
  });

  // [WORD-TC: TC-SKEY-02]
  // Chức năng: Sai owner/purpose/regex → lỗi 400 tại service, không gọi storage
  it("[TC-SKEY-02] Sai owner/purpose/regex → lỗi 400 tại service, không gọi storage", () => {
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

  // [WORD-TC: TC-SKEY-03]
  // Chức năng: Owner được chuẩn hóa case-insensitive giống JWT userId
  it("[TC-SKEY-03] Owner được chuẩn hóa case-insensitive giống JWT userId", () => {
    expect(
      StorageService.isMessageImageKeyOwnedBy(
        `messages/${USER}/${OBJ}.png`,
        USER.toUpperCase(),
      ),
    ).toBe(true);
  });

  // [WORD-TC: TC-SKEY-04]
  // Chức năng: Extension khớp whitelist contentType
  it("[TC-SKEY-04] Extension khớp whitelist contentType", () => {
    expect(StorageService.extensionForContentType("image/jpeg")).toBe("jpg");
    expect(StorageService.extensionForContentType("image/png")).toBe("png");
    expect(StorageService.extensionForContentType("image/webp")).toBe("webp");
    expect(StorageService.extensionForContentType("image/gif")).toBeNull();
    expect(StorageService.extensionForContentType("text/html")).toBeNull();
  });
});
