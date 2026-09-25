import { IsString, MaxLength, MinLength } from 'class-validator';

export class ProbeDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  connection!: string;
}
