import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { ChanjingService } from './chanjing.service';
class AddAssetDto {
  @IsString() @Matches(/^\d{6}\.(SH|SZ|BJ)$/) symbol!: string;
}
class WatchlistMarketTrendsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) @Matches(/^\d{6}\.(SH|SZ|BJ)$/, { each: true }) symbols!: string[];
  @IsIn(['stock', 'etf']) assetType!: 'stock' | 'etf';
}
@ApiTags('chanjing') @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller('chanjing')
export class ChanjingController {
  constructor(private readonly chanjing: ChanjingService) {}
  @Get('search') search(@Query('q') q: string) { return this.chanjing.search(q); }
  @Get('overview-index') overviewIndex() { return this.chanjing.overviewIndex(); }
  @Get('watchlist') watchlist() { return this.chanjing.watchlist(); }
  @Post('watchlist/market-trends') watchlistMarketTrends(@Body() body: WatchlistMarketTrendsDto) { return this.chanjing.watchlistMarketTrends(body.symbols, body.assetType); }
  @Post('watchlist') add(@Body() body: AddAssetDto) { return this.chanjing.add(body.symbol); }
  @Delete('watchlist/:symbol') remove(@Param('symbol') symbol: string) { return this.chanjing.remove(symbol); }
  @Get('analysis') analysis(@Query() query: Record<string, string>) { return this.chanjing.analysis(query); }
  @Get('market-trend') marketTrend(@Query() query: Record<string, string>) { return this.chanjing.marketTrend(query); }
  @Get('market-trend/dow') marketTrendDow(@Query() query: Record<string, string>) { return this.chanjing.marketTrend(query, true); }
  @Get('strong-etfs') strongEtfs(@Query('page') page?: string, @Query('sort') sort?: string) { return this.chanjing.strongEtfs(page, sort); }
  @Get('radar') radar() { return this.chanjing.radar(); }
  @Get('radar/jobs/:jobId') radarJob(@Param('jobId') jobId: string) { return this.chanjing.radarJob(jobId); }
}
