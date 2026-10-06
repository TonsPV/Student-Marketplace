import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from "class-validator";

// dto/send-message.dto.ts
export class SendMessageDto {
  @IsUUID()
  postId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({}, { each: true })
  images?: string[];
}