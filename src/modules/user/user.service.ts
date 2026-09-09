import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { RegisterUserDto } from '../auth/dto/register.dto';
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
