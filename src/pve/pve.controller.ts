import { Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/auth.guard';
import { PveMonitorService } from './pve-monitor.service';

@ApiTags('pve')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pve')
export class PveController {
  constructor(private readonly monitor: PveMonitorService) {}

  @Get('overview')
  @ApiOperation({ summary: '获取 PVE 节点、VM/LXC 和存储概览' })
  overview() {
    return this.monitor.overview();
  }

  @Post('refresh')
  @ApiOperation({ summary: '手动触发 PVE 资源采集并返回最新概览' })
  refresh() {
    return this.monitor.refreshNow();
  }

  @Get('nodes/:node/history')
  @ApiOperation({ summary: '获取 PVE 节点 RRD 历史数据' })
  @ApiQuery({ name: 'timeframe', required: false, enum: ['hour', 'day', 'week', 'month', 'year'] })
  nodeHistory(@Param('node') node: string, @Query('timeframe') timeframe = 'hour') {
    return this.monitor.nodeHistory(node, timeframe);
  }

  @Get('guests/:type/:node/:vmid')
  @ApiOperation({ summary: '获取 VM/LXC 当前资源详情' })
  guestDetails(
    @Param('type') type: string,
    @Param('node') node: string,
    @Param('vmid', ParseIntPipe) vmid: number,
  ) {
    return this.monitor.guestDetails(type, node, vmid);
  }

  @Get('guests/:type/:node/:vmid/history')
  @ApiOperation({ summary: '获取 VM/LXC RRD 历史数据' })
  @ApiQuery({ name: 'timeframe', required: false, enum: ['hour', 'day', 'week', 'month', 'year'] })
  guestHistory(
    @Param('type') type: string,
    @Param('node') node: string,
    @Param('vmid', ParseIntPipe) vmid: number,
    @Query('timeframe') timeframe = 'hour',
  ) {
    return this.monitor.guestHistory(type, node, vmid, timeframe);
  }
}
