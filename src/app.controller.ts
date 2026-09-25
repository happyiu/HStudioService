import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: '服务健康检查' })
  health(): { status: string } {
    return { status: 'ok' };
  }
}
