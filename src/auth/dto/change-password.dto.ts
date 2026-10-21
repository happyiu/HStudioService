import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ minLength: 1, maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({ minLength: 10, maxLength: 256 })
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  newPassword!: string;
}
