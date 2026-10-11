import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";
import { AVATAR_IMAGE_KEY_REGEX } from "../../storage/storage.constants";

export class UpdateAvatarDto {
  @ApiProperty({
    description: "Object key returned by uploads/presign with purpose avatar",
  })
  @IsString()
  @MaxLength(256)
  @Matches(AVATAR_IMAGE_KEY_REGEX)
  key!: string;
}
