import {
  createAppFeedbackValidation,
  updateAppFeedbackValidation,
} from "../app/modules/appFeedback/appFeedback.validation";

const create = (body: Record<string, unknown>) =>
  createAppFeedbackValidation.safeParse({ body });

describe("App feedback validation", () => {
  it("accepts a valid feedback", () => {
    expect(
      create({
        rating: 4,
        category: "suggestion",
        comment: "Add dark mode",
        appVersion: "1.0.3",
        platform: "android",
        deviceModel: "Pixel 7",
      }).success
    ).toBe(true);
  });

  it("accepts feedback without a comment (non-bug)", () => {
    expect(create({ rating: 5, category: "compliment" }).success).toBe(true);
  });

  it("rejects a rating outside 1-5", () => {
    expect(create({ rating: 0, category: "other" }).success).toBe(false);
    expect(create({ rating: 6, category: "other" }).success).toBe(false);
    expect(create({ rating: 3.5, category: "other" }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(create({ rating: 3, category: "spam" }).success).toBe(false);
  });

  it("requires a comment for bug reports", () => {
    expect(create({ rating: 2, category: "bug" }).success).toBe(false);
    expect(
      create({ rating: 2, category: "bug", comment: "App crashes" }).success
    ).toBe(true);
  });

  it("rejects comments over 1000 characters", () => {
    expect(
      create({ rating: 3, category: "other", comment: "a".repeat(1001) }).success
    ).toBe(false);
  });

  it("rejects extra fields such as userId or status", () => {
    expect(
      create({ rating: 3, category: "other", userId: "x" }).success
    ).toBe(false);
    expect(
      create({ rating: 3, category: "other", status: "resolved" }).success
    ).toBe(false);
  });

  it("validates admin updates", () => {
    const id = "507f1f77bcf86cd799439011";
    const update = (body: Record<string, unknown>, params = { id }) =>
      updateAppFeedbackValidation.safeParse({ params, body });

    expect(update({ status: "reviewed" }).success).toBe(true);
    expect(update({ adminNote: "Fixed in 1.0.4" }).success).toBe(true);
    expect(update({}).success).toBe(false);
    expect(update({ status: "deleted" }).success).toBe(false);
    expect(update({ status: "new" }, { id: "bad" }).success).toBe(false);
  });
});
