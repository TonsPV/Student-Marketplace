import { UserService } from "../../user/user.service";
import { BadRequestException, Injectable } from '@nestjs/common';
import { compare, genSaltSync, hashSync } from 'bcryptjs';


@Injectable()
export class PasswordService {
  constructor(
    private userService: UserService,
  ) {}

  getHashPassword(password: string) {
    const salt = genSaltSync(10);
    const hash = hashSync(password, salt);
    return hash;
  }

  async isValidPassword(password: string, hash: string) {
    return compare(password, hash);
  }
}
