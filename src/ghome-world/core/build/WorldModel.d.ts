import { WorldMap } from '../../types';
export const MAP_COLUMNS: number;
export const MAP_ROWS: number;
export const TILE: number;
export const MAP_VERSION: string;
export const WORLD_VERSION: number;
export const DEFINITIONS: Record<string, any>;
export function objectCells(value: any): Array<{ column: number; row: number }>;
export function createInitialWorld(options?: any): WorldMap;
export function validateSnapshot(value: unknown): WorldMap;
export default class WorldModel {
  constructor(snapshot?: WorldMap);
  data: WorldMap;
  snapshot(): WorldMap;
  restore(snapshot: WorldMap): void;
  clearExampleHills(): number;
  surfaceBase(column: number, row: number): string | null;
  syncFarmSpot(column: number, row: number): void;
  safeActors(actors: Array<{ x: number; y: number; width: number; height: number; movementMode?: string }>): boolean;
}
