import { Controller } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

@Controller('refresh-tokens')
export class RefreshTokenController {
  constructor(private readonly refreshTokenService: RefreshTokenService) {}
}