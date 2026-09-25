import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/auth.guard';
import { LuckyService } from './lucky.service';

@ApiTags('lucky')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lucky')
export class LuckyController {
  constructor(private readonly luckyService: LuckyService) {}

  @Get('status')
  @ApiOperation({ summary: '查看 Lucky 接入状态' })
  status() {
    return this.luckyService.status();
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '同步 Lucky 站点' })
  sync() {
    return this.luckyService.sync();
  }
}
