import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/types';
import { CreateDeviceDto } from './dto/create-device.dto';
import { ProbeDeviceDto } from './dto/probe-device.dto';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('probe')
  @ApiOperation({ summary: '探测设备地址' })
  probe(@Body() dto: ProbeDeviceDto) {
    return this.devicesService.probe(dto.connection);
  }

  @Post()
  @ApiOperation({ summary: '登录并保存设备连接' })
  connect(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeviceDto) {
    return this.devicesService.connect(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取当前用户的设备' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.list(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除设备连接' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.devicesService.remove(user.id, id);
  }
}
