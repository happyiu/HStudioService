import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { GetuiService, PushError } from './getui.service';
import { NotificationsService } from './notifications.service';
import { installWebhookParser } from './webhook-parser';
import { MessageTags1710000000008 } from '../database/migrations/1710000000008-MessageTags';
import { MessageDeletion1710000000009 } from '../database/migrations/1710000000009-MessageDeletion';

test('tag migration preserves existing messages and defaults their tags to an empty array', async () => {
  const db = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
  const runner = db.createQueryRunner(); const migration = new MessageTags1710000000008();
  try {
    await db.query('CREATE TABLE hub_messages (id text PRIMARY KEY, content text)');
    await db.query('INSERT INTO hub_messages VALUES (?, ?)', ['old-message', '保留旧正文']);
    await migration.up(runner);
    assert.deepEqual(await db.query('SELECT * FROM hub_messages'), [{ id: 'old-message', content: '保留旧正文', tagsJson: '[]' }]);
    const deletion = new MessageDeletion1710000000009(); await deletion.up(runner);
    assert.deepEqual(await db.query('SELECT * FROM hub_messages'), [{ id: 'old-message', content: '保留旧正文', tagsJson: '[]', deletedAt: null }]);
    await deletion.down(runner);
    await migration.down(runner);
    assert.deepEqual(await db.query('SELECT * FROM hub_messages'), [{ id: 'old-message', content: '保留旧正文' }]);
  } finally { await runner.release(); await db.destroy(); }
});

test('webhook HTTP, durable outbox, account isolation and session lifecycle', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hstudio-notifications-'));
  Object.assign(process.env, { DB_PATH: join(directory, 'hub.sqlite'), JWT_SECRET: 'notification-tests-secret-at-least-32-characters',
    ADMIN_USERNAME: 'notify-test', ADMIN_PASSWORD: 'notify-test-password', NODE_ENV: 'test',
    GETUI_APP_ID: '', GETUI_APP_KEY: '', GETUI_MASTER_SECRET: '', GETUI_ANDROID_PACKAGE: '' });
  const { AppModule } = await import('../app.module');
  let app: NestExpressApplication | undefined; let base = ''; let db: DataSource; let service: NotificationsService; let getui: GetuiService;
  let alice = ''; let bob = ''; const sent: any[] = []; let sendingError: Error | undefined;
  async function start() {
    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
    installWebhookParser(app); app.useBodyParser('json', { limit: '2mb' }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter()); await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    db = app.get(DataSource); service = app.get(NotificationsService); getui = app.get(GetuiService);
    clearInterval((service as any).timer);
    getui.send = async (target, payload) => { if (sendingError) throw sendingError; sent.push({ target, payload }); return 'test-provider-task'; };
  }
  async function http(path: string, method = 'GET', data?: any, token?: string) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  async function login(username = 'notify-test') {
    const result = await http('/auth/login', 'POST', { username, password: 'notify-test-password' }); assert.equal(result.status, 200); return result.body;
  }
  const dto = (eventId: string) => ({ eventId, title: '备份完成', content: '<b>纯文本</b>；' + '正文'.repeat(200), data: { taskId: 'secret-not-for-push' } });
  let source: any;
  const receive = (eventId: string) => http(`/webhooks/${source.id}/messages`, 'POST', dto(eventId), source.secret);
  const device = (n: number) => ({ installationId: `installation_test_${n}`, cid: `test_client_identifier_${n}`, platform: 'android', enabled: true });
  try {
    await start(); alice = (await login()).accessToken;
    const [user] = await db!.query('SELECT * FROM users WHERE username = ?', ['notify-test']);
    const bobId = randomUUID();
    await db!.query('INSERT INTO users(id,username,passwordHash,role,isActive) VALUES(?,?,?,?,1)', [bobId, 'bob', user.passwordHash, 'admin']);
    bob = (await login('bob')).accessToken;
    assert.equal((await http('/messages')).status, 401);
    source = (await http('/webhook-sources', 'POST', { name: '服务器监控' }, alice)).body;
    assert.ok(source.secret); assert.equal(source.secret.length, 43);
    assert.ok(!(await http('/webhook-sources', 'GET', undefined, alice)).body[0].secretHash);
    const [stored] = await db!.query('SELECT secretHash FROM webhook_sources WHERE id = ?', [source.id]); assert.notEqual(stored.secretHash, source.secret);
    assert.equal((await http(`/webhook-sources/${source.id}`, 'PATCH', { name: '窃取' }, bob)).status, 404);
    assert.equal((await http(`/webhook-sources/${source.id}/reset-secret`, 'POST', {}, bob)).status, 404);
    assert.equal((await http(`/webhooks/${source.id}/messages`, 'POST', dto('bad'), alice)).status, 401);
    assert.equal((await http(`/webhooks/${source.id}/messages`, 'POST', { title: '', content: 'a' }, source.secret)).status, 400);
    assert.equal((await http(`/webhooks/${source.id}/messages`, 'POST', { ...dto('bad'), userId: bobId }, source.secret)).status, 400);
    assert.equal((await http(`/webhooks/${source.id}/messages`, 'POST', { ...dto('oversized'), data: { text: 'x'.repeat(66000) } }, source.secret)).status, 413);
    await http(`/webhook-sources/${source.id}`, 'PATCH', { enabled: false }, alice); assert.equal((await receive('disabled')).status, 403);
    await http(`/webhook-sources/${source.id}`, 'PATCH', { enabled: true }, alice);
    const registered = await http('/push-devices', 'POST', device(1), alice); assert.equal(registered.status, 201);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => receive('same-event')));
    assert.ok(concurrent.every(result => result.status === 202)); assert.equal(new Set(concurrent.map(result => result.body.messageId)).size, 1);
    assert.equal(concurrent.filter(result => !result.body.duplicate).length, 1);
    const messageId = concurrent[0].body.messageId;
    assert.equal((await db!.query('SELECT * FROM push_deliveries WHERE messageId = ?', [messageId])).length, 1);
    // A repeated registration must preserve queued tasks.
    assert.equal((await http('/push-devices', 'POST', device(1), alice)).body.id, registered.body.id);
    await service!.processDue(); assert.equal(sent.length, 0);
    assert.match((await db!.query('SELECT * FROM push_deliveries WHERE messageId = ?', [messageId]))[0].lastError, /配置/);
    const config = app!.get(ConfigService);
    for (const key of ['GETUI_APP_ID', 'GETUI_APP_KEY', 'GETUI_MASTER_SECRET']) config.set(key, 'test'); config.set('GETUI_ANDROID_PACKAGE', 'com.test.hstudio');
    await db!.query("UPDATE push_deliveries SET nextAttemptAt = 0"); await service!.processDue(); assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.messageId, messageId); assert.ok(!JSON.stringify(sent[0]).includes('secret-not-for-push')); assert.equal(sent[0].payload.summary.length, 160);
    assert.equal((await http(`/messages/${messageId}`, 'GET', undefined, bob)).status, 404);
    assert.equal((await http(`/messages/${messageId}/read`, 'PATCH', {}, bob)).status, 404);
    assert.equal((await http('/messages', 'GET', undefined, alice)).body.unreadCount, 1);
    await http(`/messages/${messageId}/read`, 'PATCH', {}, alice);
    const detail = (await http(`/messages/${messageId}`, 'GET', undefined, alice)).body;
    assert.deepEqual(detail.tags, []);
    assert.equal(detail.data.taskId, 'secret-not-for-push'); assert.equal(detail.deliveries[0].status, 'accepted');
    assert.equal((await http('/messages', 'GET', undefined, alice)).body.unreadCount, 0);
    assert.equal((await http('/messages?page=-1', 'GET', undefined, alice)).status, 400);
    // A DB failure must roll back the message as well as its tasks.
    await db!.query("CREATE TRIGGER fail_delivery BEFORE INSERT ON push_deliveries BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.equal((await receive('rollback')).status, 500);
    assert.equal((await db!.query("SELECT id FROM hub_messages WHERE eventId = 'rollback'")).length, 0);
    await db!.query('DROP TRIGGER fail_delivery'); assert.equal((await receive('rollback')).status, 202);
    sendingError = new PushError('temporary network failure'); await service!.processDue();
    assert.equal((await db!.query("SELECT status FROM push_deliveries WHERE status = 'pending'")).length, 1);
    // Simulate a crash after claiming a task; module restart recovers the durable record.
    await db!.query("UPDATE push_deliveries SET status = 'sending',nextAttemptAt = 0 WHERE status = 'pending'");
    await app!.close(); app = undefined; sendingError = undefined; await start();
    alice = (await login()).accessToken; bob = (await login('bob')).accessToken;
    await service!.processDue(); assert.equal(sent.length, 2);
    // Account switch on the same installation cancels Alice's tasks, routes new messages to Bob.
    const cancel = await receive('cancel-on-switch');
    const bobDevice = await http('/push-devices', 'POST', device(1), bob);
    assert.equal(bobDevice.status, 201);
    await service!.processDue(); assert.equal(sent.length, 2);
    assert.equal((await http(`/messages/${cancel.body.messageId}`, 'GET', undefined, alice)).body.deliveries[0].status, 'cancelled');
    const noDevice = await receive('no-device'); assert.equal((await http(`/messages/${noDevice.body.messageId}`, 'GET', undefined, alice)).body.deliveries.length, 0);
    // Multiple sessions fan out, and revocation immediately disables only the target session.
    const phone1 = await login(); const phone2 = await login();
    await http('/push-devices', 'POST', device(2), phone1.accessToken); await http('/push-devices', 'POST', device(3), phone2.accessToken);
    const multi = await receive('multi');
    await http(`/auth/sessions/${phone1.refreshToken.split('.')[0]}`, 'DELETE', undefined, alice);
    await service!.processDue(); assert.equal(sent.length, 3); assert.equal(sent[2].target.cid, device(3).cid);
    assert.deepEqual((await http(`/messages/${multi.body.messageId}`, 'GET', undefined, alice)).body.deliveries.map((d: any) => d.status).sort(), ['accepted', 'cancelled']);
    const expiration = await receive('expired'); await db!.query('UPDATE hub_messages SET expiresAt = 0 WHERE id = ?', [expiration.body.messageId]);
    await service!.processDue(); assert.equal(sent.length, 3);
    const logoutTask = await receive('logout'); await http('/auth/logout', 'POST', {}, phone2.accessToken); await service!.processDue(); assert.equal(sent.length, 3);
    assert.equal((await http(`/messages/${logoutTask.body.messageId}`, 'GET', undefined, alice)).body.deliveries[0].status, 'cancelled');
    await http('/auth/logout-all', 'POST', {}, bob); assert.equal((await http('/messages', 'GET', undefined, bob)).status, 401);
    const oldSecret = source.secret; const reset = await http(`/webhook-sources/${source.id}/reset-secret`, 'POST', {}, alice); source.secret = reset.body.secret;
    assert.equal((await http(`/webhooks/${source.id}/messages`, 'POST', dto('old'), oldSecret)).status, 401); assert.equal((await receive('new-secret')).status, 202);
    // Cursor pagination stays anchored when new messages arrive, including tied timestamps.
    const stamp = Date.now() + 1000;
    for (let i = 0; i < 45; i++) await db!.query(`INSERT INTO hub_messages(id,userId,sourceId,sourceName,eventId,title,content,createdAt,expiresAt)
      VALUES(?,?,?,?,?,?,?,?,?)`, [randomUUID(), user.id, source.id, '分页测试', `cursor-${i}`, `消息 ${i}`, '分页正文', stamp + i % 3, stamp + 3600000]);
    const snapshot = await db!.query('SELECT id FROM hub_messages WHERE userId = ? ORDER BY createdAt DESC,id DESC', [user.id]);
    const first = (await http('/messages', 'GET', undefined, alice)).body; assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
    const legacySecond = (await http('/messages?page=2', 'GET', undefined, alice)).body;
    assert.deepEqual(legacySecond.items.map((item: any) => item.id), snapshot.slice(20, 40).map((item: any) => item.id));
    await db!.query(`INSERT INTO hub_messages(id,userId,sourceId,sourceName,eventId,title,content,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), user.id, source.id, '分页测试', 'insert-after-page-1', '新到消息', '不应影响旧游标', stamp + 1000, stamp + 3600000]);
    const loaded = first.items.map((item: any) => item.id); let cursor = first.nextCursor; let pages = 0;
    while (cursor) {
      assert.ok(++pages < 10);
      const result = await http(`/messages?before=${encodeURIComponent(cursor)}`, 'GET', undefined, alice); assert.equal(result.status, 200);
      loaded.push(...result.body.items.map((item: any) => item.id)); cursor = result.body.nextCursor;
    }
    assert.deepEqual(loaded, snapshot.map((item: any) => item.id)); assert.equal(new Set(loaded).size, loaded.length);
    assert.equal((await http('/messages?before=not-a-cursor', 'GET', undefined, alice)).status, 400);
    const invalidCursor = Buffer.from(JSON.stringify({ createdAt: 'bad', id: randomUUID() })).toString('base64url');
    assert.equal((await http(`/messages?before=${invalidCursor}`, 'GET', undefined, alice)).status, 400);
    const bobFresh = await login('bob');
    assert.equal((await http(`/messages?before=${first.nextCursor}`, 'GET', undefined, bobFresh.accessToken)).body.items.length, 0);
    // Tags survive storage and are filtered before pagination, within the current account.
    for (const tags of [null, 'indicator', [''], ['  '], [3], ['a', ' a '], ['x'.repeat(33)], Array.from({ length: 11 }, (_, i) => String(i))]) {
      assert.equal((await http(`/webhooks/${source.id}/messages`, 'POST', { ...dto('invalid-tags'), tags }, source.secret)).status, 400);
    }
    const tagged = await http(`/webhooks/${source.id}/messages`, 'POST', { ...dto('tagged'), tags: [' indicator ', 'etf'], data: { symbol: '159605.SZ', price: 0 } }, source.secret);
    assert.equal(tagged.status, 202);
    const taggedDetail = (await http(`/messages/${tagged.body.messageId}`, 'GET', undefined, alice)).body;
    assert.deepEqual(taggedDetail.tags, ['indicator', 'etf']); assert.equal(taggedDetail.data.price, 0);
    assert.equal((await db!.query('SELECT tagsJson FROM hub_messages WHERE id = ?', [tagged.body.messageId]))[0].tagsJson, '["indicator","etf"]');
    const duplicateTag = await http(`/webhooks/${source.id}/messages`, 'POST', { ...dto('tagged'), tags: ['changed'] }, source.secret);
    assert.equal(duplicateTag.body.duplicate, true);
    for (let i = 0; i < 22; i++) await db!.query(`INSERT INTO hub_messages(id,userId,sourceId,sourceName,title,content,tagsJson,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), user.id, source.id, '标签测试', '指标', '正文', '["indicator"]', stamp - i, stamp + 3600000]);
    const taggedPage = (await http('/messages?tag=indicator', 'GET', undefined, alice)).body;
    assert.equal(taggedPage.total, 23); assert.equal(taggedPage.items.length, 20); assert.ok(taggedPage.nextCursor);
    assert.deepEqual(taggedPage.availableTags, ['etf', 'indicator']);
    assert.ok(taggedPage.items.every((item: any) => item.tags.includes('indicator')));
    const taggedSecond = (await http(`/messages?tag=indicator&before=${taggedPage.nextCursor}`, 'GET', undefined, alice)).body;
    assert.equal(taggedSecond.items.length, 3); assert.equal(taggedSecond.nextCursor, null);
    assert.equal(new Set([...taggedPage.items, ...taggedSecond.items].map((item: any) => item.id)).size, 23);
    const etf = (await http('/messages?tag=etf', 'GET', undefined, alice)).body;
    assert.equal(etf.items[0].data.symbol, '159605.SZ'); assert.equal(etf.total, 1);
    assert.equal(etf.unreadCount, (await http('/messages', 'GET', undefined, alice)).body.unreadCount);
    assert.equal((await http('/messages?tag=missing', 'GET', undefined, alice)).body.items.length, 0);
    const otherAccount = (await http('/messages?tag=indicator', 'GET', undefined, bobFresh.accessToken)).body;
    assert.deepEqual(otherAccount.availableTags, []); assert.equal(otherAccount.items.length, 0);
    assert.equal((await http('/messages?tag=', 'GET', undefined, alice)).status, 400);
    assert.equal((await http('/messages?tag=indicator&tag=etf', 'GET', undefined, alice)).status, 400);
    const dayStart = Date.UTC(2025, 1, 1); const dayEnd = dayStart + 86400000;
    for (let i = 0; i < 25; i++) {
      const createdAt = i === 0 ? dayStart - 1 : i === 24 ? dayEnd : i === 23 ? dayEnd - 1 : dayStart + i - 1;
      await db!.query('INSERT INTO hub_messages(id,userId,sourceId,sourceName,title,content,tagsJson,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?)',
        [randomUUID(), user.id, source.id, '日期测试', '当日消息', '正文', '["indicator"]', createdAt, dayEnd + 3600000]);
    }
    const dateQuery = `from=${dayStart}&to=${dayEnd}`;
    const dated = (await http(`/messages?${dateQuery}&tag=indicator`, 'GET', undefined, alice)).body;
    assert.equal(dated.total, 23); assert.equal(dated.items.length, 20); assert.ok(dated.nextCursor);
    assert.ok(dated.items.every((item: any) => item.createdAt >= dayStart && item.createdAt < dayEnd));
    const datedMore = (await http(`/messages?${dateQuery}&tag=indicator&before=${dated.nextCursor}`, 'GET', undefined, alice)).body;
    assert.equal(datedMore.items.length, 3); assert.equal(datedMore.nextCursor, null);
    assert.equal(new Set([...dated.items, ...datedMore.items].map((item: any) => item.id)).size, 23);
    assert.equal((await http(`/messages?${dateQuery}&tag=etf`, 'GET', undefined, alice)).body.total, 0);
    assert.equal((await http(`/messages?${dateQuery}`, 'GET', undefined, bobFresh.accessToken)).body.total, 0);
    for (const query of ['from=1', 'to=2', 'from=2&to=1', 'from=1&to=1', 'from=NaN&to=2', 'from=-1&to=2', 'from=1&from=2&to=3', 'from=1&to=9007199254740992']) {
      assert.equal((await http(`/messages?${query}`, 'GET', undefined, alice)).status, 400);
    }
    const bobSource = (await http('/webhook-sources', 'POST', { name: 'Bob 通知' }, bobFresh.accessToken)).body;
    await http(`/webhooks/${bobSource.id}/messages`, 'POST', dto('bob-unread'), bobSource.secret);
    assert.equal((await http('/messages/read-all', 'PATCH')).status, 401);
    await db!.query("CREATE TRIGGER fail_read_all BEFORE UPDATE OF readAt ON hub_messages BEGIN SELECT RAISE(ABORT, 'read failure'); END");
    assert.equal((await http('/messages/read-all', 'PATCH', {}, alice)).status, 500);
    await db!.query('DROP TRIGGER fail_read_all');
    assert.ok((await http('/messages', 'GET', undefined, alice)).body.unreadCount > 0);
    const allRead = await http('/messages/read-all', 'PATCH', {}, alice);
    assert.equal(allRead.status, 200); assert.ok(Number.isSafeInteger(allRead.body.readAt));
    assert.equal((await http('/messages', 'GET', undefined, alice)).body.unreadCount, 0);
    assert.equal((await http('/messages', 'GET', undefined, bobFresh.accessToken)).body.unreadCount, 1);
    assert.equal((await http(`/messages/${messageId}`, 'GET', undefined, alice)).body.readAt, detail.readAt);
    await http('/messages/read-all', 'PATCH', {}, alice);
    assert.equal((await http(`/messages/${tagged.body.messageId}`, 'GET', undefined, alice)).body.readAt, allRead.body.readAt);
    // Single/batch deletion is owner scoped, atomic and cancels pending deliveries without breaking deduplication.
    await http('/push-devices', 'POST', device(99), alice);
    const deleting: string[] = [];
    for (const eventId of ['delete-single', 'delete-batch-1', 'delete-batch-2']) {
      const result = await http(`/webhooks/${source.id}/messages`, 'POST', { ...dto(eventId), tags: ['only-delete'] }, source.secret);
      assert.equal(result.status, 202); deleting.push(result.body.messageId);
    }
    const beforeDelete = (await http('/messages', 'GET', undefined, alice)).body;
    assert.equal(beforeDelete.unreadCount, 3);
    assert.equal((await http(`/messages/${deleting[0]}`, 'DELETE')).status, 401);
    assert.equal((await http(`/messages/${deleting[0]}`, 'DELETE', undefined, bobFresh.accessToken)).status, 404);
    const [bobMessage] = await db!.query('SELECT id FROM hub_messages WHERE userId = ?', [bobId]);
    assert.equal((await http('/messages/delete', 'POST', { ids: [deleting[0], bobMessage.id] }, alice)).status, 404);
    assert.equal((await http(`/messages/${deleting[0]}`, 'GET', undefined, alice)).status, 200);
    for (const ids of [null, [], ['bad-id'], [deleting[0], deleting[0]], Array.from({ length: 101 }, () => randomUUID())]) {
      assert.equal((await http('/messages/delete', 'POST', { ids }, alice)).status, 400);
    }
    assert.equal((await http('/messages/bad-id', 'DELETE', undefined, alice)).status, 400);
    assert.equal((await http(`/messages/${deleting[0]}`, 'DELETE', undefined, alice)).status, 200);
    assert.equal((await http(`/messages/${deleting[0]}`, 'DELETE', undefined, alice)).status, 200);
    assert.equal((await http(`/messages/${deleting[0]}`, 'GET', undefined, alice)).status, 404);
    assert.equal((await http(`/messages/${deleting[0]}/read`, 'PATCH', {}, alice)).status, 404);
    const repeated = await http(`/webhooks/${source.id}/messages`, 'POST', dto('delete-single'), source.secret);
    assert.equal(repeated.body.duplicate, true); assert.equal(repeated.body.messageId, deleting[0]);
    assert.equal((await http('/messages', 'GET', undefined, alice)).body.unreadCount, 2);
    assert.ok((await db!.query('SELECT deletedAt FROM hub_messages WHERE id = ?', [deleting[0]]))[0].deletedAt);
    assert.equal((await db!.query('SELECT status FROM push_deliveries WHERE messageId = ?', [deleting[0]]))[0].status, 'cancelled');
    await db!.query("CREATE TRIGGER fail_message_delete BEFORE UPDATE OF deletedAt ON hub_messages BEGIN SELECT RAISE(ABORT, 'delete failure'); END");
    assert.equal((await http('/messages/delete', 'POST', { ids: deleting.slice(1) }, alice)).status, 500);
    await db!.query('DROP TRIGGER fail_message_delete');
    assert.equal((await http(`/messages/${deleting[1]}`, 'GET', undefined, alice)).status, 200);
    await db!.query("UPDATE push_deliveries SET status = 'sending' WHERE messageId = ?", [deleting[1]]);
    assert.equal((await http('/messages/delete', 'POST', { ids: deleting.slice(1) }, alice)).status, 200);
    const afterDelete = (await http('/messages', 'GET', undefined, alice)).body;
    assert.equal(afterDelete.unreadCount, 0); assert.equal(afterDelete.total, beforeDelete.total - 3);
    assert.ok(!afterDelete.availableTags.includes('only-delete'));
    assert.equal((await http('/messages?tag=only-delete', 'GET', undefined, alice)).body.total, 0);
    for (const id of deleting) {
      assert.equal((await http(`/messages/${id}`, 'GET', undefined, alice)).status, 404);
      assert.ok((await db!.query('SELECT status FROM push_deliveries WHERE messageId = ?', [id])).every((row: any) => row.status === 'cancelled'));
    }
    await service!.processDue(); assert.ok(!sent.some(item => deleting.includes(item.payload.messageId)));
    assert.equal((await http('/messages', 'GET', undefined, bobFresh.accessToken)).body.unreadCount, 1);
    const limits = await Promise.all(Array.from({ length: 65 }, (_, i) => receive(`rate-${i}`))); assert.ok(limits.some(result => result.status === 429));
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Getui authentication, platform channels, token refresh and safe payload', async () => {
  const config = new ConfigService({ GETUI_APP_ID: 'app', GETUI_APP_KEY: 'key', GETUI_MASTER_SECRET: 'secret', GETUI_ANDROID_PACKAGE: 'com.test.hstudio' });
  const provider = new GetuiService(config); const original = globalThis.fetch;
  const requests: any[] = []; let expired = true;
  globalThis.fetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body); requests.push({ url, body });
    if (url.endsWith('/auth')) return Response.json({ code: 0, data: { token: 'test-token', expire_time: Date.now() + 86400000 } });
    if (expired) { expired = false; return Response.json({ code: 10001 }); }
    return Response.json({ code: 0, data: { task: { cid: 'successed_offline' } } });
  }) as typeof fetch;
  try {
    const payload = { kind: 'hstudio-message' as const, messageId: randomUUID(), userId: randomUUID(), heading: '标题;end', summary: '正文', expiresAt: Date.now() + 3600000 };
    assert.equal(await provider.send({ cid: 'cid', platform: 'android' }, payload), 'task');
    const android = requests[requests.length - 1].body;
    assert.equal(JSON.parse(android.push_message.transmission).heading, payload.heading);
    assert.ok(!('title' in JSON.parse(android.push_message.transmission)));
    assert.match(android.push_channel.android.ups.notification.intent, /component=com.test.hstudio\/io.dcloud.PandoraEntry/);
    assert.ok(android.push_channel.android.ups.notification.intent.includes(encodeURIComponent(payload.heading)));
    assert.notEqual(requests[1].body.request_id, requests[3].body.request_id);
    await provider.send({ cid: 'cid', platform: 'ios' }, payload);
    assert.equal(requests[requests.length - 1].body.push_channel.ios.aps.alert.title, payload.heading);
    assert.ok(!requests[requests.length - 1].body.push_channel.ios.payload.includes('heading'));
    await provider.send({ cid: 'cid', platform: 'android' }, { ...payload, heading: '💡'.repeat(100), summary: '💡'.repeat(160) });
    const bounded = requests[requests.length - 1].body.push_channel.android.ups.notification;
    assert.equal(Array.from(bounded.title).length, 32); assert.equal(Array.from(bounded.body).length, 100); assert.ok(bounded.intent.length <= 2048);
    globalThis.fetch = (async () => { throw Error('contains secret token'); }) as typeof fetch;
    await assert.rejects(provider.send({ cid: 'cid', platform: 'ios' }, payload), error => error instanceof PushError && !error.message.includes('secret token'));
  } finally { globalThis.fetch = original; }
});
