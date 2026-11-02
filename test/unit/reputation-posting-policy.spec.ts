import { reputationPostingDecision } from "../../src/modules/moderation/reputation-posting-policy";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateReviewDto } from "../../src/modules/reviews/dto/update-review.dto";

describe("automatic reputation policy and review input", () => {
  it.each([
    [2, 2, false, false],
    [3, 3, true, true],
    [3, 5, true, false],
    [3, 6, false, false],
    [4, 6, true, false],
    [20, 29, true, true],
  ])(
    "evaluates exact thresholds for %i reviews with sum %i",
    (count, total, warning, blocked) => {
      expect(reputationPostingDecision(count, total)).toMatchObject({
        warning,
        blocked,
      });
    },
  );
  it.each([null, 0, 6, 1.2, "5"])(
    "rejects invalid rating %s before persistence",
    async (rating) => {
      expect(
        (await validate(plainToInstance(UpdateReviewDto, { rating }))).some(
          (e) => e.property === "rating",
        ),
      ).toBe(true);
    },
  );
  it("allows omitted rating, valid rating and clearing a comment", async () => {
    for (const payload of [
      { comment: null },
      { rating: 5 },
      { comment: "Updated" },
    ])
      expect(await validate(plainToInstance(UpdateReviewDto, payload))).toEqual(
        [],
      );
  });
});
