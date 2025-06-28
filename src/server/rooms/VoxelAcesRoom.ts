
import { Room, Client } from "@colyseus/core";
import { VoxelAcesState, Player, Bullet } from "./state/VoxelAcesState";
import * as THREE from 'three';

// Constants
const BASE_SPEED = 60;
const BOOST_MULTIPLIER = 2.0;
const PITCH_SPEED = 2.5;
const ROLL_SPEED = 2.5;
const YAW_SPEED = 1.0;
const MAX_ALTITUDE = 220;
const BOUNDARY = 950;
const GROUND_Y = -50;
const BULLET_SPEED = 200;
const BULLET_LIFESPAN_MS = 5000;
const PLAYER_HEALTH = 100;

export class VoxelAcesRoom extends Room<VoxelAcesState> {
    maxClients = 16;
    
    // Using a map to store the full THREE.js objects for server-side physics
    serverPlayers: Map<string, { position: THREE.Vector3, quaternion: THREE.Quaternion, input: any, gunCooldown: number, gunOverheat: number }> = new Map();
    serverBullets: Map<string, { position: THREE.Vector3, velocity: THREE.Vector3, spawnTime: number, ownerId: string }> = new Map();

    onCreate(options: any) {
        this.setState(new VoxelAcesState());

        // The main game loop
        this.setSimulationInterval((deltaTime) => this.update(deltaTime / 1000));

        this.onMessage("input", (client, input) => {
            const player = this.serverPlayers.get(client.sessionId);
            if (player) {
                player.input = input;
            }
        });

        this.onMessage("respawn", (client) => {
            const playerState = this.state.players.get(client.sessionId);
            if (playerState && playerState.health <= 0) {
                const serverPlayer = this.serverPlayers.get(client.sessionId);
                
                playerState.health = PLAYER_HEALTH;
                playerState.x = (Math.random() - 0.5) * 500;
                playerState.y = 50;
                playerState.z = (Math.random() - 0.5) * 500;
                playerState.qx = 0;
                playerState.qy = 0;
                playerState.qz = 0;
                playerState.qw = 1;

                if (serverPlayer) {
                    serverPlayer.position.set(playerState.x, playerState.y, playerState.z);
                    serverPlayer.quaternion.set(0, 0, 0, 1);
                }
            }
        });
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined!");
        
        const player = new Player();
        player.name = options.playerName || "Pilot";
        player.x = (Math.random() - 0.5) * 500;
        player.y = 50;
        player.z = (Math.random() - 0.5) * 500;
        player.health = PLAYER_HEALTH;

        this.state.players.set(client.sessionId, player);

        this.serverPlayers.set(client.sessionId, {
            position: new THREE.Vector3(player.x, player.y, player.z),
            quaternion: new THREE.Quaternion(),
            input: {},
            gunCooldown: 0,
            gunOverheat: 0
        });
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left!");
        this.state.players.delete(client.sessionId);
        this.serverPlayers.delete(client.sessionId);
    }

    onDispose() {
        console.log("room", this.roomId, "disposing...");
    }

    update(delta: number) {
        const now = Date.now();

        // Update players
        this.state.players.forEach((player, sessionId) => {
            const serverPlayer = this.serverPlayers.get(sessionId);
            if (!serverPlayer || player.health <= 0) return;

            const input = serverPlayer.input || {};

            if (input.w) serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -PITCH_SPEED * delta));
            if (input.s) serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PITCH_SPEED * delta));
            if (input.a) serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_SPEED * delta));
            if (input.d) serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ROLL_SPEED * delta));

            const speed = input.shift ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(serverPlayer.quaternion);
            serverPlayer.position.add(forward.multiplyScalar(speed * delta));

            // Update state for client
            player.x = serverPlayer.position.x;
            player.y = serverPlayer.position.y;
            player.z = serverPlayer.position.z;
            player.qx = serverPlayer.quaternion.x;
            player.qy = serverPlayer.quaternion.y;
            player.qz = serverPlayer.quaternion.z;
            player.qw = serverPlayer.quaternion.w;

            // Shooting logic
            serverPlayer.gunCooldown = Math.max(0, serverPlayer.gunCooldown - delta);
            serverPlayer.gunOverheat = Math.max(0, serverPlayer.gunOverheat - 15 * delta);

            if ((input.space || input.mouse0) && serverPlayer.gunCooldown <= 0 && serverPlayer.gunOverheat < 100) {
                serverPlayer.gunCooldown = 0.1;
                serverPlayer.gunOverheat += 5;

                const bulletId = Math.random().toString(36).substring(2, 15);
                const bulletState = new Bullet();
                bulletState.ownerId = sessionId;
                bulletState.x = serverPlayer.position.x;
                bulletState.y = serverPlayer.position.y;
                bulletState.z = serverPlayer.position.z;
                
                this.state.bullets.set(bulletId, bulletState);

                const bulletVelocity = new THREE.Vector3(0, 0, -BULLET_SPEED).applyQuaternion(serverPlayer.quaternion);
                this.serverBullets.set(bulletId, {
                    position: serverPlayer.position.clone(),
                    velocity: bulletVelocity,
                    spawnTime: now,
                    ownerId: sessionId
                });
            }
            
            // Boundary checks & respawn
            if (player.y < GROUND_Y || Math.abs(player.x) > BOUNDARY || Math.abs(player.z) > BOUNDARY || player.y > MAX_ALTITUDE) {
                player.health = 0;
            }
        });

        // Update bullets and check collisions
        const playerHitboxes: Map<string, THREE.Box3> = new Map();
        this.state.players.forEach((p, id) => {
            const serverPlayer = this.serverPlayers.get(id);
            if(serverPlayer) {
                const hitboxGeo = new THREE.Box3().setFromCenterAndSize(
                    new THREE.Vector3(0, 0, 0), 
                    new THREE.Vector3(9, 3, 5) // Hitbox size
                );
                const matrix = new THREE.Matrix4().compose(serverPlayer.position, serverPlayer.quaternion, new THREE.Vector3(1,1,1));
                hitboxGeo.applyMatrix4(matrix);
                playerHitboxes.set(id, hitboxGeo);
            }
        });
        
        this.serverBullets.forEach((bullet, bulletId) => {
            bullet.position.add(bullet.velocity.clone().multiplyScalar(delta));

            // update client state
            const bulletState = this.state.bullets.get(bulletId);
            if(bulletState) {
                bulletState.x = bullet.position.x;
                bulletState.y = bullet.position.y;
                bulletState.z = bullet.position.z;
            }

            if (now - bullet.spawnTime > BULLET_LIFESPAN_MS) {
                this.serverBullets.delete(bulletId);
                this.state.bullets.delete(bulletId);
                return;
            }

            // Collision detection
            for (const [targetId, targetHitbox] of playerHitboxes.entries()) {
                if (targetId === bullet.ownerId) continue;
                
                const targetPlayerState = this.state.players.get(targetId);
                if (targetPlayerState && targetPlayerState.health > 0 && targetHitbox.containsPoint(bullet.position)) {
                    targetPlayerState.health -= 10;

                    if (targetPlayerState.health <= 0) {
                        targetPlayerState.health = 0;
                        const shooter = this.state.players.get(bullet.ownerId);
                        if (shooter) {
                            shooter.kills++;
                        }
                    }

                    this.serverBullets.delete(bulletId);
                    this.state.bullets.delete(bulletId);
                    break; // Bullet is destroyed, stop checking
                }
            }
        });
    }
}
