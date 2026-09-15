import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RefreshTokenService } from '../../refresh-tokens/refresh-token.service';
import { UserService } from '../../user/user.service';
import { PasswordService } from './password.service';
import { UserEntity } from '../../user/user.entity';
import { UserInterface } from '../../../shared/interfaces/user.interface';
import { RegisterUserDto } from '../dto/register.dto';
import { Response, Request } from 'express';
import { UAParser } from 'ua-parser-js';

@Injectable()
export class AuthService {
    constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private userService: UserService,
    private passwordService: PasswordService,
    private refreshTokenService: RefreshTokenService,
  ) {}

  async validateUser(
    email: string,
    pass: string,
  ): Promise<UserInterface | null> {
    const user = await this.userService.findOneByEmail(email);
    if (!user || user.isLocked || !user.password) return null;

    const isValid = await this.passwordService.isValidPassword(pass, user.password);
    if (!isValid) return null;

    return this.toSafeUser(user);
  }

  async validateGoogleUser(input: {
    email: string;
    name: string;
  }): Promise<UserInterface> {
    const user = await this.userService.findOneByEmail(input.email);

    if (user?.isLocked) {
      throw new UnauthorizedException('Account is locked');
    }

    if (user) return this.toSafeUser(user);

    const newUser = await this.userService.registerUser({
      email: input.email,
      fullName: input.name,
      password: randomUUID(), // hashed in registerUser; Google users never log in with it
      phone: '',
    });
    return this.toSafeUser(newUser);
  }

  private toSafeUser(
    user: Pick<UserEntity, 'fullName' | 'email' | 'id'>,
  ): UserInterface {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    };
  }

  async register(user: RegisterUserDto) {
    const newUser = await this.userService.registerUser(user);
    return {
      id: newUser.id,
      createdAt: newUser.createdAt,
    };
  }

  async login(user: UserInterface, request: Request, response: Response) {
    const { id, email } = user;

    const payload = {
      sub: id,
      iss: 'Backend-core',
      id,
      email,
    };

    const refreshToken = this.refreshTokenService.createRefreshToken(payload);
    const parser = new UAParser(request.headers['user-agent']);

    await this.refreshTokenService.createRefreshTokenRecord({
      userId: id,
      tokenHash: this.refreshTokenService.hashToken(refreshToken),
      expiresAt: this.refreshTokenService.getRefreshTokenExpiresAt(),
      deviceInfo: {
        browser: parser.getBrowser().name,
        browserVersion: parser.getBrowser().version,
        os: parser.getOS().name,
        osVersion: parser.getOS().version,
        device: parser.getDevice().type || 'desktop',
      },
    });

    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: this.refreshTokenService.getRefreshTokenMaxAge(),
    });

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id,
        email,
      },
    };
  }

  validateCookieOrigin(origin: string | undefined) {
    const allowedOrigin = this.configService.get<string>('FE_DOMAIN');
    if (!origin || origin === 'null' || origin !== allowedOrigin) {
      throw new ForbiddenException('Invalid request origin');
    }
  }

  async logout(refreshToken: string | undefined, response: Response) {
    if (refreshToken) {
      await this.refreshTokenService.revokeRefreshToken(refreshToken);
    }

    response.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    });

    return {
      message: 'Logout successful!',
      loggedOut: true,
      timestamp: new Date().toISOString(),
    };
  }

  async processToken(refreshToken: string, response: Response) {
    const tokenResult =
      await this.refreshTokenService.processToken(refreshToken);

    response.cookie('refresh_token', tokenResult.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: this.refreshTokenService.getRefreshTokenMaxAge(),
    });

    return {
      accessToken: tokenResult.accessToken,
      user: tokenResult.user,
    };
  }
  
  buildBrowserRedirectUrl(accessToken: string) {
    const browserRedirectUri = this.configService.get<string>(
      'BROWSER_REDIRECT_URI',
    );

    if (!browserRedirectUri) {
      throw new InternalServerErrorException(
        'Browser redirect URI is not configured',
      );
    }

    const redirectUrl = new URL(browserRedirectUri);
    redirectUrl.searchParams.delete('token');
    redirectUrl.hash = new URLSearchParams({
      access_token: accessToken,
    }).toString();

    return redirectUrl.toString();
  }
}
