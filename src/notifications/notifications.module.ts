import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GetuiService } from './getui.service';
import { NotificationsController, WebhookReceiverController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({ imports: [AuthModule], controllers: [NotificationsController, WebhookReceiverController], providers: [NotificationsService, GetuiService] })
export class NotificationsModule {}
