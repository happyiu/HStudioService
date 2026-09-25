import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Device } from '../database/entities/device.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Device])],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
