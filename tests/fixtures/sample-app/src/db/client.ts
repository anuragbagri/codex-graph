import type { User } from "../services/user-service.js";

export const dbClient = {
  getUser(id: string): User {
    return { id, name: "Ada" };
  }
};
