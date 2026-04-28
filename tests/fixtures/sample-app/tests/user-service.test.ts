import { describe, expect, it } from "vitest";
import { UserService } from "../src/services/user-service.js";

describe("UserService", () => {
  it("finds users", () => {
    expect(new UserService().findUser("1").name).toBe("Ada");
  });
});
