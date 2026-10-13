import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/types';
import { GhomeWorldGateway } from './ghome-world.gateway';
import { GhomeWorldService } from './ghome-world.service';

class BootstrapDto {
  @IsOptional() @IsObject() snapshot?: Record<string, unknown>;
  @IsOptional() @IsObject() appearance?: Record<string, string>;
}
class SaveMapDto {
  @IsString() @MaxLength(80) commandId!: string;
  @IsInt() @Min(1) baseMapRevision!: number;
  @IsObject() snapshot!: Record<string, unknown>;
}
@ApiTags('ghome-world')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ghome/world')
export class GhomeWorldController {
  constructor(private readonly worlds: GhomeWorldService, private readonly gateway: GhomeWorldGateway) {}
  @Get()
  @ApiOperation({ summary: '读取个人岛屿，未创建时返回 404' })
  read(@CurrentUser() user: AuthenticatedUser) { return this.worlds.read(user.id); }
  @Post('bootstrap') @HttpCode(200)
  @ApiOperation({ summary: '首次创建或导入岛屿，已有岛屿不会覆盖' })
  @ApiBody({ schema: { type: 'object', properties: { snapshot: { type: 'object', description: '可选的旧地图快照' }, appearance: { type: 'object' } } } })
  bootstrap(@CurrentUser() user: AuthenticatedUser, @Body() dto: BootstrapDto) { return this.worlds.bootstrap(user.id, dto); }
  @Post('join') @HttpCode(200)
  @ApiOperation({ summary: '预约已认证的 Colyseus 世界席位' })
  join(@CurrentUser() user: AuthenticatedUser, @Headers('authorization') authorization: string) { return this.gateway.join(user, authorization.slice(7)); }
  @Post('map') @HttpCode(200)
  @ApiOperation({ summary: '按地图版本保存编辑，作物时间和资源由服务器维护' })
  @ApiBody({ schema: { type: 'object', required: ['commandId', 'baseMapRevision', 'snapshot'], properties: {
    commandId: { type: 'string' }, baseMapRevision: { type: 'integer' }, snapshot: { type: 'object' },
  } } })
  saveMap(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveMapDto) {
    return this.worlds.command(user.id, { commandId: dto.commandId, type: 'map', payload: { baseMapRevision: dto.baseMapRevision, snapshot: dto.snapshot } });
  }
}
