import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthenticatedUser, RequestMetadata } from './types';

function metadata(request: Request): RequestMetadata {
  return {
    userAgent: request.get('user-agent') || undefined,
    ipAddress: request.ip || request.socket.remoteAddress || undefined,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录并创建设备会话' })
  login(@Body() credentials: LoginDto, @Req() request: Request) {
    return this.authService.login(credentials, metadata(request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '轮换 Refresh Token' })
  refresh(@Body() credentials: RefreshDto, @Req() request: Request) {
    return this.authService.refresh(credentials, metadata(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '退出当前设备' })
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤销当前用户的全部会话' })
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAll(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, username: user.username, role: user.role };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '查看当前用户的登录会话' })
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '撤销指定登录会话' })
  revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') sessionId: string) {
    return this.authService.revokeSession(user.id, sessionId);
  }
}
