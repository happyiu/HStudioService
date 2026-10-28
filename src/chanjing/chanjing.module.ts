import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChanjingController } from './chanjing.controller';
import { ChanjingService } from './chanjing.service';
@Module({ imports: [AuthModule], controllers: [ChanjingController], providers: [ChanjingService] })
export class ChanjingModule {}
