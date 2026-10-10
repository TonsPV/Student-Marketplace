import { Body, Controller, Delete, Get, Param, Patch } from "@nestjs/common";
import { UserService } from "./user.service";
import { ResponseMessage } from "../../common/decorators/customize.decorator";
import { ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { CheckPolicies } from "../authorization/decorators/check-policies.decorator";
import { GetAuthorizationContext } from "../authorization/decorators/get-authorization-context.decorator";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { AccountLifecycleService } from "../../common/account-lifecycle/account-lifecycle.service";

@Controller("user")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly accountLifecycle: AccountLifecycleService,
  ) {}

  @Get("/me")
  @CheckPolicies({ action: "read", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Get my profile successfully!")
  async getMyProfile(@GetAuthorizationContext() ctx: AuthenticatedContext) {
    return this.userService.getMyProfile(ctx);
  }

  @Get("/:id")
  @CheckPolicies({ action: "read", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Get user profile successfully!")
  async getUserProfile(
    @Param("id") userId: string,
    @GetAuthorizationContext() ctx: AuthorizationContext,
  ) {
    return this.userService.getUserProfile(userId, ctx);
  }

  @Patch("/me")
  @CheckPolicies({ action: "update", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Update my profile successfully!")
  @ApiBody({ type: UpdateUserDto })
  async updateMyProfile(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateMyProfile(dto, ctx);
  }

  @Patch("/me/location")
  @CheckPolicies({ action: "updateLocation", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Update default location successfully!")
  async updateDefaultLocation(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.userService.updateDefaultLocation(ctx, dto);
  }

  @Patch("/:id/lock")
  @CheckPolicies({ action: "lock", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Lock account successfully!")
  async lockAccount(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Param("id") userId: string,
  ) {
    const locked = await this.accountLifecycle.lockAccount(ctx, userId);
    return { locked };
  }

  @Patch("/:id/unlock")
  @CheckPolicies({ action: "unlock", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Unlock account successfully!")
  async unlockAccount(
    @GetAuthorizationContext() ctx: AuthenticatedContext,
    @Param("id") userId: string,
  ) {
    const locked = await this.accountLifecycle.unlockAccount(ctx, userId);
    return { locked };
  }

  @Delete("/me")
  @CheckPolicies({ action: "delete", subject: "User" })
  @ApiBearerAuth("access-token")
  @ResponseMessage("Delete account successfully!")
  async deleteMyAccount(@GetAuthorizationContext() ctx: AuthenticatedContext) {
    await this.accountLifecycle.deleteOwnAccount(ctx);
    return { deleted: true };
  }
}
