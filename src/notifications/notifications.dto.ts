import { Transform } from 'class-transformer';
import { ArrayMinSize, ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsUUID, ValidateIf, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class DeleteMessagesDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('4', { each: true })
  ids!: string[];
}
export class CreateSourceDto {
  @ApiProperty({ maxLength: 80 }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
}
export class UpdateSourceDto {
  @ApiPropertyOptional({ maxLength: 80 }) @ValidateIf((_, value) => value !== undefined) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsBoolean() enabled?: boolean;
}
export class ReceiveMessageDto {
  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => Array.isArray(value) ? value.map(tag => typeof tag === 'string' ? tag.trim() : tag) : value)
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(32, { each: true })
  tags?: string[];
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
