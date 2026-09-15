import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { RegisterUserDto } from '../auth/dto/register.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { hashSync } from 'bcryptjs';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(UserEntity)
        private userRepository: Repository<UserEntity>,
    ) { }

    findOneByEmail(email: string) {
        return this.userRepository.findOne({
            where: {
                email: email,
            },
        });
    }

    async getMyProfile(userId: string) {
        const user = await this.userRepository.findOneOrFail({
            where: { id: userId },
        });
        return this.toProfile(user);
    }

    async getUserProfile(userId: string) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            withDeleted: true,
        });
        if (!user || user.deletedAt) {
            throw new NotFoundException('User not found');
        }
        return this.toProfile(user);
    }

    async updateMyProfile(dto: UpdateUserDto, userId: string) {
        const user = await this.userRepository.findOneByOrFail({ id: userId });

        const updated = await this.userRepository.save({
            ...user,
            ...dto,
        });
        return this.toProfile(updated);
    }

    async softDeleteUser(userId: string) {
        await this.userRepository.softDelete(userId);
    }

    private toProfile(user: UserEntity) {
        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt,
        };
    }

    async registerUser(data: RegisterUserDto) {
        const user = this.userRepository.create({
            email: data.email,
            password: hashSync(data.password, 10),
            fullName: data.fullName,
            phone: data.phone,
        });

        try {
            return await this.userRepository.save(user);
        } catch (error) {
            if (error instanceof QueryFailedError) {
                const driverError = error.driverError as Error & { code?: string; constraint?: string };
                if (driverError.code === '23505' && driverError.constraint === 'idx_user_email_active') {
                    throw new ConflictException('Email already exists');
                }
            }
            throw error;
        }
    }
}
