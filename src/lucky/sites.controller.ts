import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/auth.guard';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { LuckyService } from './lucky.service';

@ApiTags('sites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sites')
export class SitesController {
  constructor(private readonly luckyService: LuckyService) {}

  @Get()
  @ApiOperation({ summary: '获取站点列表' })
  list() {
    return this.luckyService.list();
  }

  @Post()
  @ApiOperation({ summary: '新增自定义站点' })
  create(@Body() dto: CreateSiteDto) {
    return this.luckyService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取站点详情' })
  get(@Param('id') id: string) {
    return this.luckyService.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改站点显示配置' })
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.luckyService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除自定义站点' })
  remove(@Param('id') id: string) {
    return this.luckyService.remove(id);
  }
}
