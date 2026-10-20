import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/types';
import { CreateSourceDto, ReceiveMessageDto, RegisterPushDeviceDto, UpdateSourceDto } from './notifications.dto';
import { GetuiService, PushError } from './getui.service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const ACTIVE_SESSION = `s.revokedAt IS NULL AND julianday(s.expiresAt) > julianday('now') AND u.isActive = 1`;
const SOURCE_FIELDS = 'id, name, enabled, createdAt';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private writes: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  private rates = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: DataSource, private readonly getui: GetuiService) {}

  private write<T>(action: () => Promise<T>): Promise<T> {
    const next = this.writes.then(action);
    this.writes = next.catch(() => undefined); return next;
  }
  async onModuleInit(): Promise<void> {
    // A single backend instance owns this outbox; interrupted sends may be retried.
    await this.db.query("UPDATE push_deliveries SET status = 'pending' WHERE status = 'sending'");
    this.timer = setInterval(() => { void this.processDue().catch(() => this.logger.error('推送任务处理失败，稍后重试')); }, 3000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true; clearInterval(this.timer); await this.running; await this.writes;
  }
  async listSources(userId: string) {
    const rows = await this.db.query(`SELECT ${SOURCE_FIELDS} FROM webhook_sources WHERE userId = ? ORDER BY createdAt DESC`, [userId]);
    return rows.map((row: any) => ({ ...row, enabled: !!row.enabled }));
  }
  async createSource(userId: string, dto: CreateSourceDto) {
    const id = randomUUID(); const secret = randomBytes(32).toString('base64url'); const createdAt = Date.now();
    await this.write(() => this.db.query('INSERT INTO webhook_sources(id,userId,name,secretHash,enabled,createdAt) VALUES(?,?,?,?,1,?)', [id, userId, dto.name, hash(secret), createdAt]));
    return { id, name: dto.name, enabled: true, createdAt, secret };
  }
  private async source(manager: EntityManager, userId: string, id: string) {
    const [source] = await manager.query('SELECT * FROM webhook_sources WHERE id = ? AND userId = ?', [id, userId]);
    if (!source) throw new NotFoundException('Webhook 来源不存在'); return source;
  }
  async updateSource(userId: string, id: string, dto: UpdateSourceDto) {
    return this.write(async () => {
      const source = await this.source(this.db.manager, userId, id);
      await this.db.query('UPDATE webhook_sources SET name = ?, enabled = ? WHERE id = ?', [dto.name ?? source.name, dto.enabled === undefined ? source.enabled : Number(dto.enabled), id]);
      return { id, name: dto.name ?? source.name, enabled: dto.enabled ?? !!source.enabled, createdAt: source.createdAt };
    });
  }
  async resetSecret(userId: string, id: string) {
    return this.write(async () => {
      await this.source(this.db.manager, userId, id);
      const secret = randomBytes(32).toString('base64url');
      await this.db.query('UPDATE webhook_sources SET secretHash = ? WHERE id = ?', [hash(secret), id]);
      return { id, secret };
    });
  }
  async receive(id: string, authorization: string | undefined, dto: ReceiveMessageDto) {
    return this.write(() => this.db.transaction(async manager => {
      const [source] = await manager.query('SELECT w.* FROM webhook_sources w JOIN users u ON u.id = w.userId WHERE w.id = ? AND u.isActive = 1', [id]);
      const secret = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || '';
      if (!source || !timingSafeEqual(Buffer.from(hash(secret), 'hex'), Buffer.from(source.secretHash, 'hex'))) throw new UnauthorizedException('Webhook 密钥无效');
      if (!source.enabled) throw new ForbiddenException('Webhook 来源已停用');
      const now = Date.now(); let rate = this.rates.get(id);
      if (!rate || rate.until <= now) { rate = { count: 0, until: now + 60000 }; this.rates.set(id, rate); }
      if (++rate.count > 60) throw new HttpException('Webhook 每分钟最多 60 次请求', 429);
      if (dto.eventId) {
        const [existing] = await manager.query('SELECT id FROM hub_messages WHERE sourceId = ? AND eventId = ?', [id, dto.eventId]);
        if (existing) return { messageId: existing.id, duplicate: true };
      }
      const messageId = randomUUID();
      await manager.query(`INSERT INTO hub_messages(id,userId,sourceId,sourceName,eventId,title,content,dataJson,tagsJson,createdAt,expiresAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [messageId, source.userId, id, source.name, dto.eventId ?? null, dto.title, dto.content, dto.data ? JSON.stringify(dto.data) : null, JSON.stringify(dto.tags ?? []), now, now + 3600000]);
      await manager.query(`INSERT INTO push_deliveries(id,messageId,deviceId,sessionId,cid,status,attempts,nextAttemptAt,updatedAt)
        SELECT lower(hex(randomblob(16))), ?, d.id, d.sessionId, d.cid, 'pending', 0, ?, ? FROM push_devices d
        JOIN auth_sessions s ON s.id = d.sessionId AND s.userId = d.userId JOIN users u ON u.id = d.userId
        WHERE d.userId = ? AND d.enabled = 1 AND ${ACTIVE_SESSION}`, [messageId, now, now, source.userId]);
      return { messageId, duplicate: false };
    }));
  }
  async registerDevice(user: AuthenticatedUser, dto: RegisterPushDeviceDto) {
    return this.write(() => this.db.transaction(async manager => {
      const existing = await manager.query('SELECT * FROM push_devices WHERE installationId = ? OR cid = ?', [dto.installationId, dto.cid]);
      const current = existing.find((row: any) => row.installationId === dto.installationId);
      if (existing.length === 1 && current?.userId === user.id && current.sessionId === user.sessionId && current.cid === dto.cid && current.platform === dto.platform && !!current.enabled === dto.enabled) {
        await manager.query('UPDATE push_devices SET updatedAt = ? WHERE id = ?', [Date.now(), current.id]);
        return { id: current.id, enabled: dto.enabled };
      }
      // Replace the installation's old account and invalidate tasks that captured its old CID/session.
      for (const row of existing) {
        await manager.query("UPDATE push_deliveries SET status = 'cancelled', lastError = '设备绑定已更新' WHERE deviceId = ? AND status IN ('pending','sending')", [row.id]);
        if (row.id !== current?.id) {
          await manager.query('UPDATE push_devices SET cid = ?, installationId = ?, enabled = 0 WHERE id = ?', [`retired_${row.id}`, `retired_${row.id}`, row.id]);
        }
      }
      const deviceId = current?.id || randomUUID();
      await manager.query(`INSERT INTO push_devices(id,installationId,cid,userId,sessionId,platform,enabled,updatedAt) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET cid=excluded.cid,userId=excluded.userId,sessionId=excluded.sessionId,platform=excluded.platform,enabled=excluded.enabled,updatedAt=excluded.updatedAt`,
        [deviceId, dto.installationId, dto.cid, user.id, user.sessionId, dto.platform, Number(dto.enabled), Date.now()]);
      return { id: deviceId, enabled: dto.enabled };
    }));
  }
  async devices(user: AuthenticatedUser) {
    return { configured: this.getui.configured, androidConfigured: this.getui.androidConfigured,
      devices: await this.db.query(`SELECT d.id, d.platform, d.updatedAt, CASE WHEN ${ACTIVE_SESSION} THEN d.enabled ELSE 0 END AS enabled
        FROM push_devices d JOIN auth_sessions s ON s.id = d.sessionId JOIN users u ON u.id = d.userId WHERE d.userId = ?`, [user.id]) };
  }
  async unregisterDevice(user: AuthenticatedUser, id: string) {
    return this.write(async () => {
      const [device] = await this.db.query('SELECT id FROM push_devices WHERE id = ? AND userId = ? AND sessionId = ?', [id, user.id, user.sessionId]);
      if (!device) throw new NotFoundException('推送设备不存在');
      await this.db.query('UPDATE push_devices SET enabled = 0 WHERE id = ?', [id]);
      await this.db.query("UPDATE push_deliveries SET status = 'cancelled', lastError = '设备已解绑' WHERE deviceId = ? AND status IN ('pending','sending')", [id]);
      return { success: true };
    });
  }
  async listMessages(userId: string, page: number, before?: string, tag?: unknown, from?: unknown, to?: unknown) {
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException('page 必须是正整数');
    if (tag !== undefined && (typeof tag !== 'string' || !tag.trim() || tag.length > 32)) throw new BadRequestException('tag 必须是 1–32 字符的标签');
    if (from !== undefined || to !== undefined) {
      const timestamp = (value: unknown) => typeof value === 'string' && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 8640000000000000;
      if (!timestamp(from) || !timestamp(to) || Number(from) >= Number(to)) throw new BadRequestException('from 和 to 必须为有效的毫秒时间戳，且 from 小于 to');
    }
    let cursor: { createdAt: number; id: string } | undefined;
    if (before !== undefined) {
      try {
        if (typeof before !== 'string' || before.length > 512 || !/^[A-Za-z0-9_-]+$/.test(before)) throw Error();
        cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
        if (!cursor || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0 || typeof cursor.id !== 'string' || !/^[a-f0-9-]{36}$/.test(cursor.id)) throw Error();
      } catch { throw new BadRequestException('分页游标无效'); }
    }
    const [counts] = await this.db.query('SELECT COUNT(*) AS total, COALESCE(SUM(readAt IS NULL),0) AS unreadCount FROM hub_messages WHERE userId = ? AND deletedAt IS NULL', [userId]);
    const filters = (tag === undefined ? '' : 'AND EXISTS (SELECT 1 FROM json_each(tagsJson) WHERE value = ?)') + (from === undefined ? '' : ' AND createdAt >= ? AND createdAt < ?');
    const params: (string | number)[] = tag === undefined ? [userId] : [userId, tag];
    if (from !== undefined) params.push(Number(from), Number(to));
    if (tag !== undefined || from !== undefined) {
      const [filtered] = await this.db.query(`SELECT COUNT(*) AS total FROM hub_messages WHERE userId = ? AND deletedAt IS NULL ${filters}`, params);
      counts.total = filtered.total;
    }
    const availableTags = await this.db.query(`SELECT DISTINCT t.value AS tag FROM hub_messages m, json_each(m.tagsJson) t WHERE m.userId = ? AND m.deletedAt IS NULL ORDER BY t.value`, [userId]);
    const rows = await this.db.query(`SELECT id,sourceName,title,substr(content,1,160) AS preview,tagsJson,dataJson,createdAt,readAt FROM hub_messages WHERE userId = ? AND deletedAt IS NULL ${filters}
      ${cursor ? 'AND (createdAt < ? OR (createdAt = ? AND id < ?))' : ''}
      ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ?`, cursor ? [...params, cursor.createdAt, cursor.createdAt, cursor.id, 0] : [...params, (page - 1) * 20]);
    const items = rows.slice(0, 20).map(({ tagsJson, dataJson, ...row }: any) => ({ ...row, tags: JSON.parse(tagsJson), data: dataJson ? JSON.parse(dataJson) : null })); const last = items[items.length - 1];
    const nextCursor = rows.length > 20 ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
    return { ...counts, items, page, pageSize: 20, nextCursor, availableTags: availableTags.map((row: any) => row.tag) };
  }
  async message(userId: string, id: string) {
    const [row] = await this.db.query('SELECT * FROM hub_messages WHERE id = ? AND userId = ? AND deletedAt IS NULL', [id, userId]);
    if (!row) throw new NotFoundException('消息不存在');
    const deliveries = await this.db.query('SELECT status,attempts,lastError,updatedAt FROM push_deliveries WHERE messageId = ?', [id]);
    const { dataJson, tagsJson, deletedAt, ...message } = row; return { ...message, tags: JSON.parse(tagsJson), data: dataJson ? JSON.parse(dataJson) : null, deliveries };
  }
  async markRead(userId: string, id: string) {
    return this.write(async () => {
      await this.message(userId, id);
      await this.db.query('UPDATE hub_messages SET readAt = COALESCE(readAt,?) WHERE id = ? AND userId = ?', [Date.now(), id, userId]);
      return { success: true };
    });
  }
  async markAllRead(userId: string) {
    return this.write(async () => {
      const readAt = Date.now();
      await this.db.query('UPDATE hub_messages SET readAt = ? WHERE userId = ? AND readAt IS NULL AND deletedAt IS NULL', [readAt, userId]);
      return { success: true, readAt };
    });
  }
  async deleteMessages(userId: string, ids: string[]) {
    return this.write(() => this.db.transaction(async manager => {
      const placeholders = ids.map(() => '?').join(',');
      const owned = await manager.query(`SELECT id FROM hub_messages WHERE userId = ? AND id IN (${placeholders})`, [userId, ...ids]);
      if (owned.length !== ids.length) throw new NotFoundException('消息不存在');
      await manager.query(`UPDATE hub_messages SET deletedAt = ? WHERE userId = ? AND deletedAt IS NULL AND id IN (${placeholders})`, [Date.now(), userId, ...ids]);
      await manager.query(`UPDATE push_deliveries SET status = 'cancelled',lastError = '消息已删除',updatedAt = ? WHERE messageId IN (${placeholders}) AND status IN ('pending','sending')`, [Date.now(), ...ids]);
      return { success: true };
    }));
  }
  processDue(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = undefined; }); return this.running;
  }
  private async drain(): Promise<void> {
    const now = Date.now();
    for (const [id, rate] of this.rates) if (rate.until <= now) this.rates.delete(id);
    const tasks = await this.db.query("SELECT id FROM push_deliveries WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY nextAttemptAt LIMIT 20", [now]);
    for (const task of tasks) {
      if (this.stopped) return;
      const row = await this.write(async () => {
        const [row] = await this.db.query(`SELECT p.*, m.userId, m.title, m.content, m.expiresAt, d.platform,
          CASE WHEN m.deletedAt IS NULL AND d.enabled = 1 AND d.userId = m.userId AND d.sessionId = p.sessionId AND d.cid = p.cid AND ${ACTIVE_SESSION} THEN 1 ELSE 0 END AS valid
          FROM push_deliveries p JOIN hub_messages m ON m.id = p.messageId JOIN push_devices d ON d.id = p.deviceId
          JOIN auth_sessions s ON s.id = p.sessionId JOIN users u ON u.id = m.userId WHERE p.id = ? AND p.status = 'pending'`, [task.id]);
        if (!row) return null;
        if (!row.valid || row.expiresAt <= Date.now()) {
          await this.db.query("UPDATE push_deliveries SET status = 'cancelled',lastError = ?,updatedAt = ? WHERE id = ?", [row.valid ? '通知已过期' : '登录或设备绑定已失效', Date.now(), row.id]); return null;
        }
        if (!this.getui.configured || (row.platform === 'android' && !this.getui.androidConfigured)) {
          await this.db.query("UPDATE push_deliveries SET lastError = '推送配置未完成',nextAttemptAt = ?,updatedAt = ? WHERE id = ?", [Date.now() + 30000, Date.now(), row.id]); return null;
        }
        await this.db.query("UPDATE push_deliveries SET status = 'sending', attempts = attempts + 1,updatedAt = ? WHERE id = ?", [Date.now(), row.id]); return row;
      });
      if (!row) continue;
      try {
        const providerTaskId = await this.getui.send(row, { kind: 'hstudio-message', messageId: row.messageId, userId: row.userId,
          heading: row.title, summary: row.content.slice(0, 160), expiresAt: row.expiresAt });
        await this.write(() => this.db.query("UPDATE push_deliveries SET status = 'accepted',providerTaskId = ?,lastError = NULL,updatedAt = ? WHERE id = ? AND status = 'sending'", [providerTaskId, Date.now(), row.id]));
      } catch (error) {
        const permanent = error instanceof PushError && error.permanent;
        await this.write(() => this.db.query("UPDATE push_deliveries SET status = ?,lastError = ?,nextAttemptAt = ?,updatedAt = ? WHERE id = ? AND status = 'sending'", [
          permanent || row.attempts + 1 >= 8 ? 'failed' : 'pending', error instanceof PushError ? error.message : '推送发送失败',
          Date.now() + Math.min(300000, 5000 * 2 ** row.attempts), Date.now(), row.id]));
      }
    }
  }
}
