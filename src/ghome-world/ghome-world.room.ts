import { Room, Client, ServerError } from '@colyseus/core';
import { Schema, defineTypes } from '@colyseus/schema';
import { HttpException, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { GhomeWorldService } from './ghome-world.service';

export const SESSION_REPLACED = 4100;
export const AUTH_EXPIRED = 4101;
class WorldState extends Schema { session = ''; }
defineTypes(WorldState, { session: 'string' });

export class GhomeWorldRoom extends Room<{ state: WorldState }> {
  private ownerId = '';
  private worldId = '';
  private deleted = false;
  private deletedSave = () => {
    this.deleted = true; this.active = undefined;
    void this.disconnect(4102).catch(() => this.logger.error('已删除的存档连接关闭失败'));
  };
  private active?: Client;
  private readonly logger = new Logger(GhomeWorldRoom.name);
  constructor(private readonly worlds: GhomeWorldService, private readonly auth: AuthService) { super(); }
  private changed = () => { void this.sync().catch(() => this.logger.error('世界状态同步失败')); };
  async onCreate(options: { ownerId: string; worldId: string }) {
    this.ownerId = options.ownerId; this.worldId = options.worldId; this.maxClients = 8; this.patchRate = 100;
    if ((await this.worlds.read(this.ownerId)).worldId !== this.worldId) throw new ServerError(409, '存档已变更，请重新载入');
    await this.setPrivate(true);
    this.state = new WorldState();
    await this.sync();
    this.worlds.updates.on(this.ownerId, this.changed);
    this.worlds.updates.on(`${this.ownerId}:deleted`, this.deletedSave);
    this.clock.setInterval(this.changed, 1000);
    this.clock.setInterval(() => { void this.worlds.flush(this.ownerId).catch(() => {
      this.active?.send('save-error', { message: '位置保存失败，正在重试' });
    }); }, 5000);
  }
  async onAuth(client: Client) {
    if (!client.auth?.user || !client.auth?.token) throw new ServerError(401, '请通过已认证接口进入世界');
    const user = await this.auth.verifyAccessToken(client.auth.token);
    if (this.deleted || (await this.worlds.read(this.ownerId)).worldId !== this.worldId) throw new ServerError(409, '存档已变更，请重新载入');
    if (user.id !== this.ownerId) throw new ServerError(403, '不能进入其他账号的世界');
    return client.auth;
  }
  async onJoin(client: Client) {
    const previous = this.active; this.active = client;
    if (previous && previous !== client) previous.leave(SESSION_REPLACED, '已在其他设备打开');
    // Replaced seats must not keep an obsolete controller alive.
    for (const other of this.clients) if (other !== client && other !== previous) other.leave(SESSION_REPLACED, '已在其他设备打开');
    this.onMessage('move', (sender, value) => this.run(sender, () => this.worlds.move(this.ownerId, value), false));
    this.onMessage('checkpoint', (sender, value) => this.run(sender, () => this.worlds.checkpoint(this.ownerId, value), false));
    this.onMessage('command', (sender, value) => this.run(sender, () => this.worlds.command(this.ownerId, value), true, value?.commandId));
    await this.sync();
  }
  private async run(client: Client, work: () => Promise<any>, reply: boolean, commandId?: string) {
    if (this.deleted || client !== this.active) return;
    try {
      await this.auth.verifyAccessToken(client.auth.token);
      if (this.deleted || client !== this.active) return;
      const result = await work();
      if (reply) client.send('result', result);
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const message = status === 500 ? '世界保存失败，请重试' : (error as Error).message;
      if (status === 401) client.leave(AUTH_EXPIRED, '登录需要刷新');
      else client.send(reply ? 'result' : 'operation-error', { commandId, ok: false, status, message });
    }
  }
  async onDrop(client: Client) {
    if (this.deleted || client !== this.active) return;
    try { await this.allowReconnection(client, 30); }
    catch { if (this.active === client) this.active = undefined; await this.worlds.flush(this.ownerId); }
  }
  async onReconnect(client: Client) {
    if (client.sessionId !== this.active?.sessionId) { client.leave(SESSION_REPLACED); return; }
    this.active = client;
    try { await this.auth.verifyAccessToken(client.auth.token); await this.sync(); }
    catch { client.leave(AUTH_EXPIRED); }
  }
  async onLeave(client: Client) {
    if (this.active === client) this.active = undefined;
    await this.worlds.flush(this.ownerId);
  }
  private async sync() { if (!this.deleted) this.state.session = JSON.stringify(await this.worlds.state(this.ownerId)); }
  async onDispose() {
    this.worlds.updates.removeListener(this.ownerId, this.changed);
    this.worlds.updates.removeListener(`${this.ownerId}:deleted`, this.deletedSave);
    await this.worlds.release(this.ownerId);
  }
}
