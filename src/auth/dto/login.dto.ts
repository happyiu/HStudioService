import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @ApiProperty({ example: 'your-password', minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
