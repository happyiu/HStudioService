import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Client, Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { GhomeWorldGateway } from './ghome-world.gateway';
import { GhomeWorldService } from './ghome-world.service';
import { createInitialWorld } from './core/build/WorldModel.js';
import { HttpExceptionFilter } from '../common/http-exception.filter';

async function until(check: () => boolean | Promise<boolean>, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw Error('Timed out waiting for world state'); await new Promise(resolve => setTimeout(resolve, 30)); }
}
function message(room: Room<any, { session: string }>, command: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Missing command receipt')), 4000);
    const off = room.onMessage('result', result => { off(); clearTimeout(timeout); resolve(result); });
    room.send('command', command);
  });
}
test('real Nest HTTP and Colyseus seats restore after drops, empty-room disposal and service restart', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ghome-network-'));
  Object.assign(process.env, { DB_PATH: join(directory, 'world.sqlite'), JWT_SECRET: 'world-network-test-secret-at-least-32-characters',
    ADMIN_USERNAME: 'world-test', ADMIN_PASSWORD: 'world-test-password', NODE_ENV: 'test' });
  const { AppModule } = await import('../app.module');
  let app: NestExpressApplication | undefined; let endpoint = ''; let token = ''; let now = Date.now();
  const rooms: Room<any, { session: string }>[] = [];
  async function start() {
    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
    app.useBodyParser('json', { limit: '2mb' }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.get(GhomeWorldService).now = () => now;
    await app.init(); await app.get(GhomeWorldGateway).start(app.getHttpServer(), 0, '127.0.0.1');
    endpoint = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const login = await fetch(`${endpoint}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'world-test', password: 'world-test-password' }) });
    assert.equal(login.status, 200); token = (await login.json()).accessToken;
  }
  async function http(path = '', body?: any) {
    const response = await fetch(`${endpoint}/api/v1/ghome/world${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function enter() {
    const reservation = await http('/join', {}); assert.equal(reservation.status, 200);
    const room = await new Client(endpoint).consumeSeatReservation<{ session: string }>(reservation.body); rooms.push(room);
    await until(() => !!room.state?.session); return room;
  }
  try {
    await start();
    assert.equal((await fetch(`${endpoint}/api/v1/ghome/world`)).status, 401);
    const preflight = await fetch(`${endpoint}/api/v1/ghome/world`, { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,cache-control,pragma' } });
    assert.equal(preflight.status, 204); assert.match(preflight.headers.get('Access-Control-Allow-Headers')!, /Cache-Control, Pragma/);
    assert.equal((await http()).status, 404);
    const map = createInitialWorld();
    map.cells.forEach(line => line.forEach(cell => { cell.base = 'grass'; cell.road = null; delete cell.inlandWater; }));
    map.spawn = { column: 10, row: 10 }; map.cells[10][10].base = 'soil'; map.crops = [{ column: 10, row: 10, stage: -1 }];
    assert.ok(JSON.stringify(map).length > 100000);
    const boot = await http('/bootstrap', { snapshot: map }); assert.equal(boot.status, 200);
    const worldId = boot.body.worldId;
    const oversized = await http('/bootstrap', { snapshot: map, padding: 'x'.repeat(2 * 1024 * 1024) }); assert.equal(oversized.status, 413);
    await assert.rejects(new Client(endpoint).create('ghome_world'), /invalid method/i);
    let room = await enter(); assert.equal(JSON.parse(room.state.session).worldId, worldId);
    const plant = { commandId: 'network-plant', type: 'plant', payload: { column: 10, row: 10 } };
    assert.equal((await message(room, plant)).session.seeds, 19);
    assert.equal((await message(room, plant)).session.seeds, 19);
    now += 1000;
    room.send('move', { x: 176, y: 164.8, facing: 'right' });
    await until(() => JSON.parse(room.state.session).player.x === 176);
    const restored = new Promise<void>(resolve => room.onReconnect.once(resolve));
    room.reconnection.minUptime = 0;
    room.connection.close(4010); await Promise.race([restored, new Promise((_, reject) => setTimeout(() => reject(Error("Reconnect did not finish")), 5000))]);
    const reconnectResult = await message(room, { commandId: 'after-reconnect', type: 'harvest', payload: { column: 10, row: 10 } });
    assert.equal(reconnectResult.ok, false); assert.match(reconnectResult.message, /尚未成熟/);
    const replaced = new Promise<number>(resolve => room.onLeave.once(resolve));
    const second = await enter(); assert.equal(await replaced, 4100); room = second;
    const mapSaved = await http('/map', { commandId: 'network-map', baseMapRevision: 1, snapshot: { ...map, objects: [{ id: 'home', type: 'house', column: 20, row: 20 }] } });
    assert.equal(mapSaved.status, 200); assert.equal(mapSaved.body.session.mapRevision, 2);
    await room.leave();
    await until(async () => (await matchMaker.query({ name: 'ghome_world' })).length === 0);
    now += 300000; room = await enter();
    assert.equal(JSON.parse(room.state.session).crops[0].stage, 3);
    assert.equal(JSON.parse(room.state.session).player.x, 176);
    await room.leave(); await app!.close(); app = undefined;
    await start(); room = await enter();
    const snapshot = await http(); assert.equal(snapshot.body.worldId, worldId); assert.equal(snapshot.body.map.objects[0].id, 'home');
    assert.equal(snapshot.body.mapRevision, 2); assert.equal(JSON.parse(room.state.session).crops[0].stage, 3);
    const harvested = await message(room, { commandId: 'network-harvest', type: 'harvest', payload: { column: 10, row: 10 } });
    assert.equal(harvested.session.vegetables, 1); assert.equal(harvested.session.seeds, 20);
    await room.leave();
  } finally {
    for (const room of rooms) { room.removeAllListeners(); room.reconnection.enabled = false; if (room.connection.isOpen) await room.leave().catch(() => undefined); }
    if (app) await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
