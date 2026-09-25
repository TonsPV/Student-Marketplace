import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { UserService } from "./user.service";
import {
  GetUser,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { AdminGuard } from "../../common/guards/admin.guard";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { RefreshTokenService } from "../refresh-token/refresh-token.service";

@Controller("user")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  @Get("/me")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Get my profile successfully!")
  async getMyProfile(@GetUser() user: UserInterface) {
    return this.userService.getMyProfile(user.id);
  }

  @Get("/:id")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Get user profile successfully!")
  async getUserProfile(@Param("id") userId: string) {
    return this.userService.getUserProfile(userId);
  }

  @Patch("/me")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Update my profile successfully!")
  @ApiBody({ type: UpdateUserDto })
  async updateMyProfile(
    @GetUser() user: UserInterface,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateMyProfile(dto, user.id);
  }

  @Patch("/me/location")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Update default location successfully!")
  async updateDefaultLocation(
    @GetUser() user: UserInterface,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.userService.updateDefaultLocation(user.id, dto);
  }

  @Patch("/:id/lock")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ResponseMessage("Lock account successfully!")
  async lockAccount(
    @GetUser() admin: UserInterface,
    @Param("id") userId: string,
  ) {
    const locked = await this.userService.setAccountLocked(
      userId,
      true,
      admin.id,
    );
    await this.refreshTokenService.revokeAllRefreshTokensForUser(userId);
    return { locked };
  }

  @Patch("/:id/unlock")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("access-token")
  @ResponseMessage("Unlock account successfully!")
  async unlockAccount(
    @GetUser() admin: UserInterface,
    @Param("id") userId: string,
  ) {
    const locked = await this.userService.setAccountLocked(
      userId,
      false,
      admin.id,
    );
    return { locked };
  }

  @Delete("/me")
  @ApiBearerAuth("access-token")
  @ResponseMessage("Delete account successfully!")
  async deleteMyAccount(@GetUser() user: UserInterface) {
    return this.userService.softDeleteUser(user.id);
  }
}
