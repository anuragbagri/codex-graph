import { createUserRouter } from "./routes/users.js";
import { UserService } from "./services/user-service.js";

const userService = new UserService();

export function createApp() {
  return {
    routes: [createUserRouter(userService)]
  };
}
