import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./services/auth.service";
import { PasswordService } from "./services/password.service";
import {
  GetUser,
  Public,
  ResponseMessage,
} from "../../common/decorators/customize.decorator";
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint } from "@nestjs/swagger";
import { LoginDto } from "./dto/login.dto";
import { Request, Response } from "express";
import { RegisterUserDto } from "./dto/register.dto";
import { GoogleAuthGuard } from "../../common/guards/google-auth.guard";
import { UserInterface } from "../../shared/interfaces/user.interface";
import { ChangePasswordDto } from "./dto/change-password.dto";

type CookieRequest = Omit<Request, "cookies"> & {
  cookies: Record<string, string | undefined>;
};

type GoogleCallbackRequest = CookieRequest & {
  user: UserInterface;
};

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
  ) {}

  @Post("/login")
  @Public()
  @ResponseMessage("Login successful!")
  @ApiBody({
    type: LoginDto,
    description: "Login information",
    examples: {
      default: {
        summary: "Login with email and password",
        value: {
          email: "admin@example.com",
          password: "12345678",
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
      throw new UnauthorizedException("Invalid Email/Password !");
    }

    return await this.authService.login(user, request, response);
  }

  @Post("/logout")
  @Public()
  @ResponseMessage("Logout successful!")
  handleLogout(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.authService.validateCookieOrigin(req.headers.origin);
    const refreshToken = req.cookies?.["refresh_token"];
    return this.authService.logout(refreshToken, response);
  }

  @Post("/register")
  @Public()
  @ResponseMessage("Register successful!")
  @ApiBody({ type: RegisterUserDto })
  async handleRegister(@Body() registerUserDto: RegisterUserDto) {
    return await this.authService.register(registerUserDto);
  }

  @Post("/refresh")
  @Public()
  @ResponseMessage("Refresh token successful!")
  async refreshToken(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.authService.validateCookieOrigin(req.headers.origin);
    const refreshToken = req.cookies["refresh_token"];
    if (!refreshToken) {
      throw new UnauthorizedException("Refresh token is required");
    }

    return this.authService.processToken(refreshToken, response);
  }

  @Post("/change-password")
  @ResponseMessage("Change password successfully!")
  @ApiBearerAuth("access-token")
  async changePassword(
    @GetUser() user: UserInterface,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  @Get("/google/login")
  @Public()
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  @ResponseMessage("Login with Google")
  handleGoogleLogin() {
    // This route will redirect to Google for authentication
  }

  @Get("/google/callback")
  @Public()
  @UseGuards(GoogleAuthGuard)
  @ResponseMessage("Google callback")
  async handleGoogleCallback(
    @Req() req: GoogleCallbackRequest,
    @Res() res: Response,
  ) {
    const loginResult = await this.authService.login(req.user, req, res);
    const redirectUrl = this.authService.buildBrowserRedirectUrl(
      loginResult.accessToken,
    );

    return res.redirect(redirectUrl);
  }
}
