import { dbClient } from "../db/client.js";

export interface User {
  id: string;
  name: string;
}

export class UserService {
  findUser(id: string): User {
    return dbClient.getUser(id);
  }
}
