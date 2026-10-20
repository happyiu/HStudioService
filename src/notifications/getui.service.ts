import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class PushError extends Error {
  constructor(message: string, readonly permanent = false) { super(message); }
}
export interface PushTarget { cid: string; platform: 'android' | 'ios' }
export interface PushPayload {
  kind: 'hstudio-message'; messageId: string; userId: string; heading: string; summary: string; expiresAt: number;
}
@Injectable()
export class GetuiService {
  private token = '';
  private tokenExpiresAt = 0;
  private authenticating?: Promise<string>;
  constructor(private readonly config: ConfigService) {}
  get configured(): boolean {
    return ['GETUI_APP_ID', 'GETUI_APP_KEY', 'GETUI_MASTER_SECRET'].every(key => !!this.config.get<string>(key)?.trim());
  }
  get androidConfigured(): boolean {
    const name = this.config.get<string>('GETUI_ANDROID_PACKAGE') || '';
    return this.configured && name.length <= 255 && /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(name);
  }
  private async request(path: string, body: object, token?: string): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`https://restapi.getui.com/v2/${encodeURIComponent(this.config.get<string>('GETUI_APP_ID') || '')}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { token } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      });
    } catch { throw new PushError('个推请求超时或网络不可用'); }
    if (!response.ok) throw new PushError(`个推 HTTP ${response.status}`, response.status === 400);
    try { return await response.json(); } catch { throw new PushError('个推响应无效'); }
  }
  private async authenticate(): Promise<string> {
    if (this.token && this.tokenExpiresAt > Date.now() + 60000) return this.token;
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      const timestamp = String(Date.now());
      const appkey = this.config.get<string>('GETUI_APP_KEY')!;
      const sign = createHash('sha256').update(appkey + timestamp + this.config.get<string>('GETUI_MASTER_SECRET')).digest('hex');
      const result = await this.request('auth', { sign, timestamp, appkey });
      if (result.code !== 0 || !result.data?.token) throw new PushError(`个推鉴权失败（${Number(result.code)}）`);
      this.token = result.data.token; this.tokenExpiresAt = Number(result.data.expire_time);
      return this.token;
    })();
    try { return await this.authenticating; } finally { this.authenticating = undefined; }
  }
  async send(target: PushTarget, payload: PushPayload): Promise<string> {
    if (!this.configured || (target.platform === 'android' && !this.androidConfigured)) throw new PushError('推送配置未完成');
    // Use the smallest vendor limits (Meizu title, Vivo/Meizu body).
    if (target.platform === 'android') payload = { ...payload, heading: Array.from(payload.heading).slice(0, 32).join(''), summary: Array.from(payload.summary).slice(0, 100).join('') };
    const transmission = JSON.stringify(payload);
    const clickPayload = JSON.stringify({ kind: payload.kind, messageId: payload.messageId, userId: payload.userId, expiresAt: payload.expiresAt });
    const channel = target.platform === 'ios' ? {
      ios: { type: 'notify', payload: clickPayload, aps: { alert: { title: payload.heading, body: payload.summary }, sound: 'default', 'content-available': 0 } },
    } : {
      android: { ups: { notification: {
        title: payload.heading, body: payload.summary, click_type: 'intent',
        intent: this.androidIntent(payload, clickPayload),
      } } },
    };
    // Custom field names avoid uni-push's title/content/payload automatic notification path.
    const body = { request_id: randomBytes(16).toString('hex'), audience: { cid: [target.cid] },
      settings: { ttl: Math.max(1, payload.expiresAt - Date.now()), strategy: { default: 1 } },
      push_message: { transmission }, push_channel: channel };
    let result = await this.request('push/single/cid', body, await this.authenticate());
    if (result.code === 10001) {
      this.token = ''; result = await this.request('push/single/cid', { ...body, request_id: randomBytes(16).toString('hex') }, await this.authenticate());
    }
    if (result.code !== 0) throw new PushError(`个推拒绝（${Number(result.code)}）`, result.code === 10002);
    const task = Object.entries(result.data || {}).find(([, value]) => typeof value === 'object' && value !== null && target.cid in value);
    const status = task && (task[1] as Record<string, string>)[target.cid];
    if (status !== 'successed_online' && status !== 'successed_offline') throw new PushError(`个推未接受目标设备（${status || 'unknown'}）`, status === 'successed_ignore');
    return task![0];
  }
  private androidIntent(payload: PushPayload, clickPayload: string): string {
    const summary = Array.from(payload.summary);
    const build = () => `intent://io.dcloud.unipush/?#Intent;scheme=unipush;launchFlags=0x4000000;component=${this.config.get<string>('GETUI_ANDROID_PACKAGE')}/io.dcloud.PandoraEntry;S.UP-OL-SU=true;S.title=${encodeURIComponent(payload.heading)};S.content=${encodeURIComponent(summary.join(''))};S.payload=${encodeURIComponent(clickPayload)};end`;
    let intent = build();
    // Vivo limits encoded Intents to 2048 characters, including emoji escapes.
    while (intent.length > 2048 && summary.length) { summary.pop(); intent = build(); }
    return intent;
  }
}
