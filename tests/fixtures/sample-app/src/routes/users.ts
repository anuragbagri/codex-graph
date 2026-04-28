import type { UserService } from "../services/user-service.js";

export function createUserRouter(userService: UserService) {
  return {
    method: "GET",
    path: "/users/:id",
    handler: () => userService.findUser("demo")
  };
}
