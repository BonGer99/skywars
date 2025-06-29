import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
    @type("string") name: string = "Pilot";
    @type("number") x: number = 0;
    @type("number") y: number = 50;
    @type("number") z: number = 0;
    @type("number") qx: number = 0;
    @type("number") qy: number = 0;
    @type("number") qz: number = 0;
    @type("number") qw: number = 1;
    @type("number") health: number = 100;
    @type("number") kills: number = 0;
    @type("number") gunOverheat: number = 0;
    @type("boolean") isAI: boolean = false;
    @type("boolean") isReady: boolean = false;
}

export class Bullet extends Schema {
    @type("string") ownerId: string = "";
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") z: number = 0;
}

export class VoxelAcesState extends Schema {
    @type({ map: Player }) players = new MapSchema<Player>();
    @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
}
