import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { ChanjingService } from './chanjing.service';
class AddAssetDto {
  @IsString() @Matches(/^\d{6}\.(SH|SZ|BJ)$/) symbol!: string;
}
@ApiTags('chanjing') @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller('chanjing')
export class ChanjingController {
  constructor(private readonly chanjing: ChanjingService) {}
  @Get('search') search(@Query('q') q: string) { return this.chanjing.search(q); }
  @Get('watchlist') watchlist() { return this.chanjing.watchlist(); }
  @Post('watchlist') add(@Body() body: AddAssetDto) { return this.chanjing.add(body.symbol); }
  @Delete('watchlist/:symbol') remove(@Param('symbol') symbol: string) { return this.chanjing.remove(symbol); }
  @Get('analysis') analysis(@Query() query: Record<string, string>) { return this.chanjing.analysis(query); }
}
