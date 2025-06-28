
import { Room, Client } from "@colyseus/core";
import { VoxelAcesState, Player, Bullet } from "./state/VoxelAcesState";
import * as THREE from 'three';

// Constants
const WORLD_SEED = 12345;
const BASE_SPEED = 60;
const BOOST_MULTIPLIER = 2.0;
const PITCH_SPEED = 1.2; 
const ROLL_SPEED = 1.5;
const MAX_ALTITUDE = 220;
const BOUNDARY = 950;
const GROUND_Y = -50;
const BULLET_SPEED = 200;
const BULLET_LIFESPAN_MS = 5000;
const PLAYER_HEALTH = 100;

interface ServerPlayerData {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    input: any;
    gunCooldown: number;
    gunOverheat: number;
    boundaryTimer: number;
    altitudeTimer: number;
}

export class VoxelAcesRoom extends Room<VoxelAcesState> {
    maxClients = 16;
    
    serverPlayers: Map<string, ServerPlayerData> = new Map();
    serverBullets: Map<string, { position: THREE.Vector3, velocity: THREE.Vector3, spawnTime: number, ownerId: string }> = new Map();
    collidableObjects: THREE.Box3[] = [];

    onCreate(options: any) {
        this.setState(new VoxelAcesState());

        // Setup world generation
        this.generateWorld();

        this.setSimulationInterval((deltaTime) => this.update(deltaTime / 1000));

        this.onMessage("input", (client, input) => {
            const player = this.serverPlayers.get(client.sessionId);
            if (player) {
                player.input = input;
            }
        });

        this.onMessage("respawn", (client) => {
            const playerState = this.state.players.get(client.sessionId);
            const serverPlayer = this.serverPlayers.get(client.sessionId);

            if (playerState && serverPlayer && playerState.health <= 0) {
                playerState.health = PLAYER_HEALTH;
                playerState.x = (Math.random() - 0.5) * 500;
                playerState.y = 50;
                playerState.z = (Math.random() - 0.5) * 500;
                playerState.qx = 0;
                playerState.qy = 0;
                playerState.qz = 0;
                playerState.qw = 1;
                playerState.kills = playerState.kills; // Keep score on respawn

                serverPlayer.position.set(playerState.x, playerState.y, playerState.z);
                serverPlayer.quaternion.set(0, 0, 0, 1);
                serverPlayer.gunCooldown = 0;
                serverPlayer.gunOverheat = 0;
                serverPlayer.boundaryTimer = 7;
                serverPlayer.altitudeTimer = 5;
            }
        });
    }

    generateWorld() {
        let seed = WORLD_SEED;
        const seededRandom = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };

        // Generate mountains
        for (let i = 0; i < 20; i++) {
            const mountainGroupPos = new THREE.Vector3((seededRandom() - 0.5) * 1800, 0, (seededRandom() - 0.5) * 1800);
            const layers = Math.floor(seededRandom() * 5) + 3;
            let baseRadius = seededRandom() * 50 + 40;
            let currentY = GROUND_Y;
            
            const mountainGroup = new THREE.Group();
            mountainGroup.position.copy(mountainGroupPos);

            for (let j = 0; j < layers; j++) {
                const height = seededRandom() * 30 + 20;
                const radius = baseRadius * ((layers - j) / layers);
                
                const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, height, 8));
                cylinder.position.y = currentY + height / 2;
                mountainGroup.add(cylinder);

                currentY += height * 0.8;
            }
            // Add a single bounding box for the entire mountain group
            this.collidableObjects.push(new THREE.Box3().setFromObject(mountainGroup));
        }

        // Generate trees
        for (let i = 0; i < 50; i++) {
            const treePos = new THREE.Vector3((seededRandom() - 0.5) * 1800, 0, (seededRandom() - 0.5) * 1800);
            const treeGroup = new THREE.Group();
            treeGroup.position.copy(treePos);

            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 6));
            trunk.position.y = 5 + GROUND_Y;
            treeGroup.add(trunk);

            const leaves = new THREE.Mesh(new THREE.ConeGeometry(5, 15, 8));
            leaves.position.y = 15 + GROUND_Y;
            treeGroup.add(leaves);
            
            this.collidableObjects.push(new THREE.Box3().setFromObject(treeGroup));
        }
    }


    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined!");
        
        const player = new Player();
        player.name = options.playerName || "Pilot";
        player.x = (Math.random() - 0.5) * 500;
        player.y = 50;
        player.z = (Math.random() - 0.5) * 500;
        player.health = PLAYER_HEALTH;
        player.gunOverheat = 0;

        this.state.players.set(client.sessionId, player);

        this.serverPlayers.set(client.sessionId, {
            position: new THREE.Vector3(player.x, player.y, player.z),
            quaternion: new THREE.Quaternion(),
            input: {},
            gunCooldown: 0,
            gunOverheat: 0,
            boundaryTimer: 7,
            altitudeTimer: 5,
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
            player.gunOverheat = serverPlayer.gunOverheat;

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
            
            // Authoritative Boundary & Altitude Checks
            const inBoundaryViolation = Math.abs(player.x) > BOUNDARY || Math.abs(player.z) > BOUNDARY;
            const inAltitudeViolation = player.y > MAX_ALTITUDE;

            if (inBoundaryViolation) {
                serverPlayer.boundaryTimer = Math.max(0, serverPlayer.boundaryTimer - delta);
            } else {
                serverPlayer.boundaryTimer = 7;
            }

            if (inAltitudeViolation) {
                serverPlayer.altitudeTimer = Math.max(0, serverPlayer.altitudeTimer - delta);
            } else {
                serverPlayer.altitudeTimer = 5;
            }

            // Authoritative Collision Checks
            const playerHitbox = new THREE.Box3().setFromObject(new THREE.Mesh(new THREE.BoxGeometry(8, 2, 4)));
            playerHitbox.applyMatrix4(new THREE.Matrix4().compose(serverPlayer.position, serverPlayer.quaternion, new THREE.Vector3(1,1,1)));

            let hasCrashed = false;
            for (const obstacle of this.collidableObjects) {
                if (playerHitbox.intersectsBox(obstacle)) {
                    hasCrashed = true;
                    break;
                }
            }
            
            if (hasCrashed || player.y < GROUND_Y || serverPlayer.boundaryTimer <= 0 || serverPlayer.altitudeTimer <= 0) {
                if (player.health > 0) player.health = 0;
            }
        });

        // Update bullets and check collisions
        const playerHitboxes: Map<string, { hitbox: THREE.Box3, player: Player }> = new Map();
        this.state.players.forEach((p, id) => {
            const serverPlayer = this.serverPlayers.get(id);
            if(serverPlayer && p.health > 0) {
                const hitbox = new THREE.Box3().setFromObject(new THREE.Mesh(new THREE.BoxGeometry(8, 2, 4)));
                hitbox.applyMatrix4(new THREE.Matrix4().compose(serverPlayer.position, serverPlayer.quaternion, new THREE.Vector3(1,1,1)));
                playerHitboxes.set(id, { hitbox, player: p });
            }
        });
        
        this.serverBullets.forEach((bullet, bulletId) => {
            bullet.position.add(bullet.velocity.clone().multiplyScalar(delta));

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
            for (const [targetId, targetData] of playerHitboxes.entries()) {
                if (targetId === bullet.ownerId) continue;
                
                if (targetData.hitbox.containsPoint(bullet.position)) {
                    targetData.player.health -= 10;

                    if (targetData.player.health <= 0) {
                        targetData.player.health = 0;
                        const shooter = this.state.players.get(bullet.ownerId);
                        if (shooter) {
                            shooter.kills++;
                        }
                    }

                    this.serverBullets.delete(bulletId);
                    this.state.bullets.delete(bulletId);
                    break;
                }
            }
        });
    }
}
