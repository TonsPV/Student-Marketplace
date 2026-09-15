import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../services/auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);
  constructor(
    configService: ConfigService, // only used before super()
    private authService: AuthService,
  ) {
    const clientID = configService.get<string>('googleOAuth.clientID');
    const clientSecret = configService.get<string>(
      'googleOAuth.clientSecret',
    );
    const redirectURI = configService.get<string>('googleOAuth.redirectURI');

    if (!clientID || !clientSecret || !redirectURI) {
      throw new Error('Google OAuth config is missing required fields');
    }

    super({
      clientID,
      clientSecret,
      callbackURL: redirectURI,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.[0]?.value;

    if (!email || !profile.id) {
      throw new UnauthorizedException(
        'Google profile is missing required information',
      );
    }

    const user = await this.authService.validateGoogleUser({
      email,
      name: profile.displayName,
    });
    done(null, user);
  }
}
