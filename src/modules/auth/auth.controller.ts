import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { Public, ResponseMessage } from '../../common/decorators/customize.decorator';
import { ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { Request, Response } from 'express';
import { RegisterUserDto } from './dto/register.dto';

type CookieRequest = Omit<Request, 'cookies'> & {
  cookies: Record<string, string | undefined>;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
  ) {}

  @Post('/login')
  @Public()
  @ResponseMessage('Login successful!')
  @ApiBody({
    type: LoginDto,
    description: 'Login information',
    examples: {
      default: {
        summary: 'Login with email and password',
        value: {
          email: 'admin@gmail.com',
          password: '12345678',
        },
      },
    },
  })
  async handleLogin(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid Email/Password !');
    }

    return await this.authService.login(user, request, response);
  }

  @Post('/logout')
  @ApiBearerAuth('access-token')
  @ResponseMessage('Logout successful!')
  handleLogout(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = req.cookies?.['refresh_token'];
    return this.authService.logout(refreshToken, response);
  }

  @Post('/register')
  @Public()
  @ResponseMessage('Đăng ký thành công!')
  @ApiBody({ type: RegisterUserDto })
  async handleRegister(@Body() registerUserDto: RegisterUserDto) {
    return await this.authService.register(registerUserDto);
  }

  @Post('/refresh')
  @Public()
  @ResponseMessage('Làm mới token thành công!')
  async refreshToken(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = req.cookies['refresh_token'];
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    return this.authService.processToken(refreshToken, response);
  }
}
