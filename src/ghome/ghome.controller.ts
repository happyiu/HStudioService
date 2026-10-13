import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/auth.guard';
import { GhomeService } from './ghome.service';

@ApiTags('ghome')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ghome')
export class GhomeController {
  constructor(private readonly ghome: GhomeService) {}

  @Get('cities')
  @ApiOperation({ summary: '搜索 Ghome 天气城市' })
  @ApiQuery({ name: 'query', required: true, type: String })
  cities(@Query('query') query: string) {
    return this.ghome.searchCities(query);
  }

  @Get('weather')
  @ApiOperation({ summary: '获取 Ghome 城市当前天气' })
  @ApiQuery({ name: 'latitude', required: true, type: Number })
  @ApiQuery({ name: 'longitude', required: true, type: Number })
  weather(@Query('latitude') latitude: string, @Query('longitude') longitude: string) {
    return this.ghome.currentWeather(latitude, longitude);
  }
}
