import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsObject, ValidateIf, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class CreateSourceDto {
  @ApiProperty({ maxLength: 80 }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
}
export class UpdateSourceDto {
  @ApiPropertyOptional({ maxLength: 80 }) @ValidateIf((_, value) => value !== undefined) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsBoolean() enabled?: boolean;
}
export class ReceiveMessageDto {
  @ApiPropertyOptional({ maxLength: 128 }) @ValidateIf((_, value) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(128) eventId?: string;
  @ApiProperty({ maxLength: 100 }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) title!: string;
  @ApiProperty({ maxLength: 16000 }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(16000) content!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @ValidateIf((_, value) => value !== undefined) @IsObject() data?: Record<string, unknown>;
}
export class RegisterPushDeviceDto {
  @ApiProperty({ minLength: 16, maxLength: 128 }) @IsString() @Matches(/^[a-zA-Z0-9_-]{16,128}$/) installationId!: string;
  @ApiProperty({ minLength: 10, maxLength: 128 }) @IsString() @Matches(/^[a-zA-Z0-9_-]{10,128}$/) cid!: string;
  @ApiProperty({ enum: ['android', 'ios'] }) @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
