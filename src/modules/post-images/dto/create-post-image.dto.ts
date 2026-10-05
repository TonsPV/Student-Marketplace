import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class CreatePostImageDto {
  @ApiProperty({ example: 'https://cdn.example.com/posts/book-1.jpg' })
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  url!: string;
}
