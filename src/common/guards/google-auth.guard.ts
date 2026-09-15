import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';

const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';

type GoogleAuthRequest = Omit<Request, 'cookies' | 'query'> & {
  cookies?: Record<string, string | undefined>;
  googleOAuthState?: string;
  query: {
    state?: unknown;
  };
};

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<GoogleAuthRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    if (request.path.endsWith('/google/login')) {
      request.googleOAuthState = randomBytes(32).toString('hex');
      response.cookie(GOOGLE_OAUTH_STATE_COOKIE, request.googleOAuthState, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/api/v1/auth/google',
        maxAge: 5 * 60 * 1000,
      });
    }

    if (request.path.endsWith('/google/callback')) {
      const queryState = request.query?.state;
      const cookieState = request.cookies?.[GOOGLE_OAUTH_STATE_COOKIE];

      response.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/api/v1/auth/google',
      });

      if (
        typeof queryState !== 'string' ||
        typeof cookieState !== 'string' ||
        queryState !== cookieState
      ) {
        throw new UnauthorizedException('Invalid Google OAuth state');
      }
    }

    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<GoogleAuthRequest>();

    return {
      session: false,
      state: request.googleOAuthState,
    };
  }
}
