import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hash } from 'bcryptjs';
import { validateOrReject } from 'class-validator';
import { UserEntity } from '../../modules/user/user.entity';
import { RegisterUserDto } from '../../modules/auth/dto/register.dto';

@Injectable()
export class AdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const dto = Object.assign(new RegisterUserDto(), {
        email: this.config.getOrThrow<string>('SEED_ADMIN_EMAIL'),
        fullName: this.config.getOrThrow<string>('SEED_ADMIN_NAME'),
        password: this.config.getOrThrow<string>('SEED_ADMIN_PASSWORD'),
        phone: this.config.getOrThrow<string>('SEED_ADMIN_PHONE'),
      });

      await validateOrReject(dto, {
        validationError: { target: false, value: false },
      });

      const existing = await this.repository.findOne({
        where: { email: dto.email },
        withDeleted: true,
      });

      if (existing) {
        this.logger.log('Seed email already exists; skipped');
        return;
      }

      await this.repository.save(this.repository.create({
        email: dto.email,
        fullName: dto.fullName,
        password: await hash(dto.password, 10),
        phone: dto.phone,
        isAdmin: true,
      }));
      this.logger.log('Admin created');
    } catch {
      // Database errors can contain the password hash in query parameters.
      throw new Error('Admin seed failed; check seed configuration and database state');
    }
  }
}
