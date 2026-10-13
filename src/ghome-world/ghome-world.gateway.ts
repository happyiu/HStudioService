import { Server as HttpServer } from 'node:http';
import { Injectable, BeforeApplicationShutdown } from '@nestjs/common';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../auth/types';
import { GhomeWorldService } from './ghome-world.service';
import { GhomeWorldRoom } from './ghome-world.room';

@Injectable()
export class GhomeWorldGateway implements BeforeApplicationShutdown {
  private server?: Server;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly worlds: GhomeWorldService, private readonly auth: AuthService) {}
  async start(httpServer: HttpServer, port: number, host: string) {
    const worlds = this.worlds; const auth = this.auth;
    class IslandRoom extends GhomeWorldRoom { constructor() { super(worlds, auth); } }
    this.server = new Server({ transport: new WebSocketTransport({ server: httpServer, maxPayload: 65536 }), gracefullyShutdown: false, greet: false });
    this.server.define('ghome_world', IslandRoom).filterBy(['worldId']);
    // Native matchmaking is only used to resume already authenticated seats.
    matchMaker.controller.exposedMethods = ['reconnect'];
    matchMaker.controller.DEFAULT_CORS_HEADERS['Access-Control-Allow-Headers'] += ', Cache-Control, Pragma';
    // Bind routes without serverless()'s unbounded body prereader: Nest keeps
    // ownership of JSON parsing and its 2 MiB upload limit.
    await this.server.listen(port, host);
  }
  join(user: AuthenticatedUser, token: string) {
    const next = this.tail.then(async () => {
      const snapshot = await this.worlds.read(user.id);
      const rooms = await matchMaker.query({ name: 'ghome_world', worldId: snapshot.worldId } as any);
      const room = rooms[0] || await matchMaker.createRoom('ghome_world', { ownerId: user.id, worldId: snapshot.worldId });
      // Auth session IDs and Colyseus seat IDs have different lifetimes.
      return matchMaker.reserveSeatFor(room, {}, { user, token });
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  async beforeApplicationShutdown() {
    await this.worlds.flush();
    await this.server?.gracefullyShutdown(false);
  }
}
