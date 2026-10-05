import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsDefined,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Max,
    Min,
    ValidateIf,
} from 'class-validator';

const hasLocationFilter = (dto: SearchPostsDto): boolean =>
    dto.lat !== undefined ||
    dto.lng !== undefined ||
    dto.radius !== undefined;

export class SearchPostsDto {
    @ApiPropertyOptional({
        type: String,
        example: 'iphone',
        description: 'Search in the post title and description.',
    })
    @IsOptional()
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Length(1, 100)
    q?: string;

    @ApiPropertyOptional({ type: String, format: 'uuid' })
    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @ApiPropertyOptional({
        type: Number,
        example: 3000000,
        minimum: 0,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(0)
    minPrice?: number;

    @ApiPropertyOptional({
        type: Number,
        example: 10000000,
        minimum: 0,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(0)
    maxPrice?: number;

    @ApiPropertyOptional({
        type: Number,
        example: 21.0285,
        minimum: -90,
        maximum: 90,
    })
    @ValidateIf(hasLocationFilter)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-90)
    @Max(90)
    lat?: number;

    @ApiPropertyOptional({
        type: Number,
        example: 105.8542,
        minimum: -180,
        maximum: 180,
    })
    @ValidateIf(hasLocationFilter)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(-180)
    @Max(180)
    lng?: number;

    @ApiPropertyOptional({
        type: Number,
        example: 5000,
        description: 'Search radius in metres.',
        minimum: 1,
        maximum: 100000,
    })
    @ValidateIf(hasLocationFilter)
    @IsDefined()
    @Type(() => Number)
    @IsNumber({ allowInfinity: false, allowNaN: false })
    @Min(1)
    @Max(100000)
    radius?: number;

    @ApiPropertyOptional({
        type: Number,
        default: 1,
        minimum: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @ApiPropertyOptional({
        type: Number,
        default: 20,
        minimum: 1,
        maximum: 50,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit = 20;
}