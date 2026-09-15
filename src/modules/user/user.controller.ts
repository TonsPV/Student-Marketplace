import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { UserService } from './user.service';
import { GetUser, ResponseMessage } from '../../common/decorators/customize.decorator';
import { ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserInterface } from '../../shared/interfaces/user.interface';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/me')
  @ApiBearerAuth('access-token')
  @ResponseMessage('Get my profile successfully!')
  async getMyProfile(@GetUser() user: UserInterface) {
    return this.userService.getMyProfile(user.id);
  }

  @Get('/:id')
  @ApiBearerAuth('access-token')
  @ResponseMessage('Get user profile successfully!')
  async getUserProfile(@Param('id') userId: string) {
    return this.userService.getUserProfile(userId);
  }

  @Patch('/me')
  @ApiBearerAuth('access-token')
  @ResponseMessage('Update my profile successfully!')
  @ApiBody({ type: UpdateUserDto })
  async updateMyProfile(
    @GetUser() user: UserInterface,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateMyProfile(dto, user.id);
  }

  @Delete('/me')
  @ApiBearerAuth('access-token')
  @ResponseMessage('Delete account successfully!')
  async deleteMyAccount(@GetUser() user: UserInterface) {
    return this.userService.softDeleteUser(user.id);
  }
}
