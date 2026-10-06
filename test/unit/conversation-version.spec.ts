import "reflect-metadata";
import { ConversationsService } from "src/modules/conversations/conversations.service";

describe("bigint version/watermark helpers (U14)", () => {
  it("nextVersion giữ precision vượt MAX_SAFE_INTEGER", () => {
    expect(ConversationsService.nextVersion("9007199254740993")).toBe(
      "9007199254740994",
    );
    expect(ConversationsService.nextVersion("0")).toBe("1");
  });

  it("order số học bằng BigInt, không lexical string", () => {
    // '10' < '9' theo lexical — thứ tự thật phải numeric.
    expect("10" < "9").toBe(true);
    expect(BigInt("10") > BigInt("9")).toBe(true);
  });
});
