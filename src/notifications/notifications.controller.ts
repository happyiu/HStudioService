import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards, DefaultValuePipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/types';
import { CreateSourceDto, DeleteMessagesDto, ReceiveMessageDto, RegisterPushDeviceDto, UpdateSourceDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookReceiverController {
  constructor(private readonly service: NotificationsService) {}
  @Post(':sourceId/messages') @HttpCode(202)
  receive(@Param('sourceId') id: string, @Headers('authorization') authorization: string | undefined, @Body() dto: ReceiveMessageDto) {
    return this.service.receive(id, authorization, dto);
  }
}
@ApiTags('messages') @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller()
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Get('webhook-sources') sources(@CurrentUser() user: AuthenticatedUser) { return this.service.listSources(user.id); }
  @Post('webhook-sources') create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSourceDto) { return this.service.createSource(user.id, dto); }
  @Patch('webhook-sources/:id') update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSourceDto) { return this.service.updateSource(user.id, id, dto); }
  @Post('webhook-sources/:id/reset-secret') reset(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.resetSecret(user.id, id); }
  @Get('push-devices') devices(@CurrentUser() user: AuthenticatedUser) { return this.service.devices(user); }
  @Post('push-devices') register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterPushDeviceDto) { return this.service.registerDevice(user, dto); }
  @Delete('push-devices/:id') unregister(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.unregisterDevice(user, id); }
  @Get('messages') messages(@CurrentUser() user: AuthenticatedUser, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number, @Query('before') before?: string, @Query('tag') tag?: unknown, @Query('from') from?: unknown, @Query('to') to?: unknown) { return this.service.listMessages(user.id, page, before, tag, from, to); }
  @Get('messages/:id') message(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.message(user.id, id); }
  @Patch('messages/:id/read') read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.markRead(user.id, id); }
  @Patch('messages/read-all') readAll(@CurrentUser() user: AuthenticatedUser) { return this.service.markAllRead(user.id); }
  @Delete('messages/:id') deleteMessage(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.service.deleteMessages(user.id, [id]); }
  @Post('messages/delete') @HttpCode(200) deleteMessages(@CurrentUser() user: AuthenticatedUser, @Body() dto: DeleteMessagesDto) { return this.service.deleteMessages(user.id, dto.ids); }
}
