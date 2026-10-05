import { UserInterface } from "../../shared/interfaces/user.interface";

export type TokenPayload = Pick<UserInterface, "email" | "id" | "isAdmin"> & {
  iss: string;
  sub: string;
};

export type RefreshTokenPayload = Pick<
  UserInterface,
  "email" | "id" | "isAdmin"
>;
