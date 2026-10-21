import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { HttpExceptionFilter } from '../common/http-exception.filter';

test('password change validates old password, updates the hash and revokes all sessions and pending pushes', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hstudio-password-'));
  Object.assign(process.env, { DB_PATH: join(directory, 'hub.sqlite'), JWT_SECRET: 'password-tests-secret-at-least-32-characters',
    ADMIN_USERNAME: 'password-test', ADMIN_PASSWORD: 'original-test-password', NODE_ENV: 'test',
    GETUI_APP_ID: '', GETUI_APP_KEY: '', GETUI_MASTER_SECRET: '', GETUI_ANDROID_PACKAGE: '' });
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const db = app.get(DataSource);
    async function http(path: string, data?: unknown, token?: string) {
      const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: {
        'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, body: data === undefined ? undefined : JSON.stringify(data) });
      return { status: response.status, body: await response.json() as any };
    }
    const login = (password = 'original-test-password') => http('/auth/login', { username: 'password-test', password });
    const first = (await login()).body;
    const second = (await login()).body;
    const [user] = await db.query('SELECT * FROM users WHERE username = ?', ['password-test']);
    await db.query('INSERT INTO users(id,username,passwordHash,role,isActive) VALUES(?,?,?,?,1)', ['another-user', 'another', user.passwordHash, 'admin']);
    const other = (await http('/auth/login', { username: 'another', password: 'original-test-password' })).body;
    const payload = { currentPassword: 'original-test-password', newPassword: 'replacement-test-password' };
    assert.equal((await http('/auth/change-password', payload)).status, 401);
    for (const bad of [
      { ...payload, currentPassword: 'wrong' }, { ...payload, newPassword: 'short' },
      { ...payload, newPassword: 'original-test-password' }, { ...payload, newPassword: 'x'.repeat(257) },
      { ...payload, newPassword: 1234567890 }, { ...payload, userId: 'another-user' },
    ]) assert.equal((await http('/auth/change-password', bad, first.accessToken)).status, 400);
    assert.equal((await http('/auth/me', undefined, first.accessToken)).status, 200);
    const rotated = await http('/auth/refresh', { refreshToken: second.refreshToken });
    assert.equal(rotated.status, 200);
    await http('/push-devices', { installationId: 'password_test_installation', cid: 'password_test_client_id', platform: 'android', enabled: true }, first.accessToken);
    const source = (await http('/webhook-sources', { name: 'password-test-source' }, first.accessToken)).body;
    const webhook = await http(`/webhooks/${source.id}/messages`, { eventId: 'password-test-event', title: '测试', content: '测试通知' }, source.secret);
    assert.equal(webhook.status, 202);
    const auth = app.get(AuthService) as any;
    const disablePush = auth.disablePush.bind(auth);
    auth.disablePush = async () => { throw Error('simulated write failure'); };
    assert.equal((await http('/auth/change-password', payload, first.accessToken)).status, 500);
    auth.disablePush = disablePush;
    assert.equal((await http('/auth/me', undefined, first.accessToken)).status, 200);
    assert.equal((await login()).status, 200);
    assert.equal((await http('/auth/change-password', payload, first.accessToken)).status, 200);
    const [stored] = await db.query('SELECT passwordHash FROM users WHERE id = ?', [user.id]);
    assert.notEqual(stored.passwordHash, payload.newPassword);
    assert.ok(await argon2.verify(stored.passwordHash, payload.newPassword));
    for (const token of [first.accessToken, second.accessToken, rotated.body.accessToken])
      assert.equal((await http('/auth/me', undefined, token)).status, 401);
    for (const refreshToken of [first.refreshToken, rotated.body.refreshToken])
      assert.equal((await http('/auth/refresh', { refreshToken })).status, 401);
    assert.equal((await login()).status, 401);
    const fresh = await login(payload.newPassword); assert.equal(fresh.status, 200);
    assert.equal((await http('/auth/me', undefined, other.accessToken)).status, 200);
    assert.equal((await db.query('SELECT enabled FROM push_devices WHERE userId = ?', [user.id]))[0].enabled, 0);
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM push_deliveries WHERE deviceId IN (SELECT id FROM push_devices WHERE userId = ?) AND status IN (\'pending\',\'sending\')', [user.id]))[0].n, 0);
    // A refresh hashing its replacement token must not revive a revoked session.
    const hash = auth.hash.bind(auth);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let hold = true;
    auth.hash = async (value: string) => {
      if (hold) { hold = false; entered(); await gate; }
      return hash(value);
    };
    const pendingRefresh = http('/auth/refresh', { refreshToken: fresh.body.refreshToken });
    await started;
    try {
      assert.equal((await http('/auth/change-password', { currentPassword: payload.newPassword, newPassword: 'final-test-password' }, fresh.body.accessToken)).status, 200);
    } finally { release(); }
    assert.equal((await pendingRefresh).status, 401);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
