export interface WorldMap {
  version: number; mapVersion: string; columns: number; rows: number;
  cells: Array<Array<{ base: string; road: string | null; inlandWater?: boolean; hillSurface?: string }>>;
  objects: Array<{ id: string; type: string; column: number; row: number; [key: string]: any }>;
  crops: Array<{ column: number; row: number; stage: number }>;
  generator?: { seed: string; landPercent: number; positions?: string[] };
  spawn?: { column: number; row: number };
}
export interface Position { x: number; y: number; facing: string }
export interface Creature extends Position { id: string; type: string }
export interface Crop { column: number; row: number; plantedAt: number; matureAt: number }
export interface WorldRuntime {
  anchorAt: number; anchorMinute: number; lastObservedAt: number;
  seasonOverride: number | null; weatherOverride: string | null;
  player: Position; appearance: Record<string, string>; creatures: Creature[];
  seeds: number; vegetables: number; crops: Crop[];
}
export interface Command { commandId: string; type: string; payload?: Record<string, any> }
