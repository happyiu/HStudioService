import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { IsNull, Repository } from 'typeorm';

import { AuthSession } from '../database/entities/auth-session.entity';
import { User } from '../database/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AccessTokenPayload, AuthenticatedUser, RequestMetadata } from './types';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const username = this.config.get<string>('ADMIN_USERNAME')?.trim();
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!username || !password) {
      this.logger.warn('ADMIN_USERNAME/ADMIN_PASSWORD 未设置，跳过首次管理员创建');
      return;
    }
    const minimumPasswordLength = this.config.get<string>('NODE_ENV') === 'production' ? 10 : 8;
    if (password.length < minimumPasswordLength) {
      throw new Error(`ADMIN_PASSWORD 至少需要 ${minimumPasswordLength} 个字符`);
    }
    if (await this.users.findOneBy({ username })) {
      return;
    }

    await this.users.save(this.users.create({
      id: randomUUID(),
      username,
      passwordHash: await this.hash(password),
      role: 'admin',
      isActive: true,
    }));
    this.logger.log(`已创建管理员账号：${username}`);
  }

  async login(credentials: LoginDto, metadata: RequestMetadata) {
    const user = await this.users.findOneBy({ username: credentials.username });
    let valid = false;
    if (user?.isActive) {
      try {
        valid = await argon2.verify(user.passwordHash, credentials.password);
      } catch {
        valid = false;
      }
    }
    if (!user || !user.isActive || !valid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const session = this.sessions.create({
      id: randomUUID(),
      userId: user.id,
      refreshTokenHash: '',
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revokedAt: null,
      lastUsedAt: new Date(),
      userAgent: metadata.userAgent?.slice(0, 255) || null,
      ipAddress: metadata.ipAddress?.slice(0, 64) || null,
    });
    const refreshToken = this.createRefreshToken(session.id);
    session.refreshTokenHash = await this.hash(refreshToken);
    await this.sessions.save(session);
    return this.issueTokens(user, session, refreshToken);
  }

  async refresh(credentials: RefreshDto, metadata: RequestMetadata) {
    const sessionId = credentials.refreshToken.split('.', 1)[0];
    const session = await this.sessions.findOneBy({ id: sessionId });
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh Token 无效或已过期');
    }

    let valid = false;
    try {
      valid = await argon2.verify(session.refreshTokenHash, credentials.refreshToken);
    } catch {
      valid = false;
    }
    if (!valid) {
      session.revokedAt = new Date();
      await this.sessions.save(session);
      throw new UnauthorizedException('Refresh Token 无效');
    }

    const user = await this.users.findOneBy({ id: session.userId });
    if (!user?.isActive) {
      session.revokedAt = new Date();
      await this.sessions.save(session);
      throw new UnauthorizedException('账号不可用');
    }

    const refreshToken = this.createRefreshToken(session.id);
    session.refreshTokenHash = await this.hash(refreshToken);
    session.expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    session.lastUsedAt = new Date();
    session.userAgent = metadata.userAgent?.slice(0, 255) || session.userAgent;
    session.ipAddress = metadata.ipAddress?.slice(0, 64) || session.ipAddress;
    await this.sessions.save(session);
    return this.issueTokens(user, session, refreshToken);
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Access Token 无效或已过期');
    }

    const session = await this.sessions.findOneBy({ id: payload.sid, userId: payload.sub });
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now() || !user?.isActive) {
      throw new UnauthorizedException('登录会话已失效');
    }
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      sessionId: session.id,
    };
  }

  async logout(user: AuthenticatedUser): Promise<{ success: boolean }> {
    await this.sessions.update(
      { id: user.sessionId, userId: user.id },
      { revokedAt: new Date() },
    );
    return { success: true };
  }

  async logoutAll(user: AuthenticatedUser): Promise<{ success: boolean }> {
    await this.sessions.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { success: true };
  }

  async listSessions(userId: string) {
    const sessions = await this.sessions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<{ success: boolean }> {
    const session = await this.sessions.findOneBy({ id: sessionId, userId });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    session.revokedAt = new Date();
    await this.sessions.save(session);
    return { success: true };
  }

  private async issueTokens(user: User, session: AuthSession, refreshToken: string) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: session.id,
      username: user.username,
      role: user.role,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: this.publicUser(user),
    };
  }

  private createRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  private hash(value: string): Promise<string> {
    return argon2.hash(value, { type: argon2.argon2id });
  }

  private publicUser(user: User) {
    return { id: user.id, username: user.username, role: user.role };
  }
}
