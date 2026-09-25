import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  connection!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  machineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceBrand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;
}
