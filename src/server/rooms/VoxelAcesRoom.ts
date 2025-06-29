import { Room, Client } from "@colyseus/core";
import { VoxelAcesState, Player, Bullet } from "./state/VoxelAcesState";
import * as THREE from 'three';

// Constants
const WORLD_SEED = 12345;
const BASE_SPEED = 60;
const BOOST_MULTIPLIER = 2.0;
const PITCH_SPEED = 1.5;
const ROLL_SPEED = 2.5;
const MAX_ALTITUDE = 220;
const BOUNDARY = 950;
const GROUND_Y = -50;
const BULLET_SPEED = 200;
const BULLET_LIFESPAN_MS = 5000;
const PLAYER_HEALTH = 100;
const BULLET_DAMAGE = 10;

const TARGET_PLAYER_COUNT = 8;
const AI_UPDATE_INTERVAL = 1000; // How often AI changes target/strategy (ms)
const AI_AVOIDANCE_DISTANCE = 75; // Distance to start avoiding obstacles
const AI_SHOOT_RANGE = 500;
const AI_SHOOT_ANGLE_THRESHOLD = 0.98; // cos(angle), higher is more accurate

const TERRAIN_COLLISION_GEOMETRY = new THREE.BoxGeometry(1.5, 1.2, 4);
const BULLET_COLLISION_GEOMETRY = new THREE.BoxGeometry(8, 2, 4);

type ControlStyle = 'realistic' | 'arcade';

interface ServerPlayerData {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    input: any;
    gunCooldown: number;
    gunOverheat: number;
    boundaryTimer: number;
    altitudeTimer: number;
    controlStyle: ControlStyle;
    isAI: boolean;
    targetId?: string;
    lastAiUpdate: number;
}

export class VoxelAcesRoom extends Room<VoxelAcesState> {
    maxClients = TARGET_PLAYER_COUNT;
    
    serverPlayers: Map<string, ServerPlayerData> = new Map();
    serverBullets: Map<string, { position: THREE.Vector3, velocity: THREE.Vector3, spawnTime: number, ownerId: string }> = new Map();
    collidableObjects: THREE.Box3[] = [];
    private botNames = ["Raptor", "Viper", "Ghost", "Phoenix", "Maverick", "Jester", "Iceman", "Shadow", "Spectre", "Cobra"];

    createScaledBox(mesh: THREE.Mesh, scale: number): THREE.Box3 {
        mesh.updateMatrixWorld();
        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        size.multiplyScalar(scale);
        return new THREE.Box3().setFromCenterAndSize(center, size);
    };

    onCreate(options: any) {
        this.setState(new VoxelAcesState());
        this.setPatchRate(1000 / 30);
        this.generateWorld();
        this.setSimulationInterval((deltaTime) => this.update(deltaTime / 1000));

        this.onMessage("input", (client, input) => {
            const player = this.serverPlayers.get(client.sessionId);
            if (player) {
                player.input = input;
            }
        });

        this.onMessage("respawn", (client) => {
            this.respawnPlayer(client.sessionId);
        });
    }

    generateWorld() {
        let seed = WORLD_SEED;
        const seededRandom = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };

        const groundBox = new THREE.Box3(
            new THREE.Vector3(-1000, GROUND_Y - 1, -1000),
            new THREE.Vector3(1000, GROUND_Y, 1000)
        );
        this.collidableObjects.push(groundBox);

        for (let i = 0; i < 20; i++) {
            const mountainPosX = (seededRandom() - 0.5) * 1800;
            const mountainPosZ = (seededRandom() - 0.5) * 1800;
            const layers = Math.floor(seededRandom() * 5) + 3;
            let baseRadius = seededRandom() * 50 + 40;
            let currentY = GROUND_Y;

            for (let j = 0; j < layers; j++) {
                const height = seededRandom() * 30 + 20;
                const radius = baseRadius * ((layers - j) / layers);
                const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 8);
                const mesh = new THREE.Mesh(geo);
                mesh.position.set(mountainPosX, currentY + height / 2, mountainPosZ);
                this.collidableObjects.push(this.createScaledBox(mesh, 0.8));
                currentY += height * 0.8;
            }
        }

        for (let i = 0; i < 50; i++) {
            const treeX = (seededRandom() - 0.5) * 1800;
            const treeZ = (seededRandom() - 0.5) * 1800;
            const trunkGeo = new THREE.CylinderGeometry(1, 1, 10, 6);
            const trunkMesh = new THREE.Mesh(trunkGeo);
            trunkMesh.position.set(treeX, GROUND_Y + 5, treeZ);
            this.collidableObjects.push(this.createScaledBox(trunkMesh, 0.8));
            const leavesGeo = new THREE.ConeGeometry(5, 15, 8);
            const leavesMesh = new THREE.Mesh(leavesGeo);
            leavesMesh.position.set(treeX, GROUND_Y + 15, treeZ);
            this.collidableObjects.push(this.createScaledBox(leavesMesh, 0.8));
        }
    }


    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined with options:", options);
        this.addPlayer(client.sessionId, false, options);
        this.checkBotPopulation();
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left!");
        this.state.players.delete(client.sessionId);
        this.serverPlayers.delete(client.sessionId);
        this.checkBotPopulation();
    }
    
    addPlayer(sessionId: string, isAI: boolean, options: any = {}) {
        const player = new Player();
        player.name = isAI ? `Bot ${this.botNames[Math.floor(Math.random() * this.botNames.length)]}` : (options.playerName || "Pilot");
        player.isAI = isAI;
        player.health = PLAYER_HEALTH;
        player.gunOverheat = 0;
        this.state.players.set(sessionId, player);

        this.serverPlayers.set(sessionId, {
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            input: {},
            gunCooldown: 0,
            gunOverheat: 0,
            boundaryTimer: 7,
            altitudeTimer: 5,
            controlStyle: options.controlStyle || 'arcade',
            isAI: isAI,
            lastAiUpdate: 0,
        });
        
        this.respawnPlayer(sessionId);
    }
    
    respawnPlayer(sessionId: string) {
        const playerState = this.state.players.get(sessionId);
        const serverPlayer = this.serverPlayers.get(sessionId);

        if (playerState && serverPlayer) {
            playerState.health = PLAYER_HEALTH;
            playerState.kills = playerState.isAI ? 0 : playerState.kills; // Reset AI kills, preserve player's
            
            const spawnX = (Math.random() - 0.5) * (BOUNDARY * 1.5);
            const spawnY = Math.random() * 100 + 40;
            const spawnZ = (Math.random() - 0.5) * (BOUNDARY * 1.5);
            
            playerState.x = spawnX;
            playerState.y = spawnY;
            playerState.z = spawnZ;
            playerState.qx = 0; playerState.qy = 0; playerState.qz = 0; playerState.qw = 1;

            serverPlayer.position.set(playerState.x, playerState.y, playerState.z);
            serverPlayer.quaternion.set(0, 0, 0, 1);
            serverPlayer.gunCooldown = 0;
            serverPlayer.gunOverheat = 0;
            serverPlayer.boundaryTimer = 7;
            serverPlayer.altitudeTimer = 5;
            serverPlayer.targetId = undefined;
            serverPlayer.lastAiUpdate = 0;
        }
    }

    checkBotPopulation() {
        const humanPlayerCount = this.clients.length;

        if (humanPlayerCount === 0) {
            // Remove all bots if no humans are present
            this.state.players.forEach((player, sessionId) => {
                if (player.isAI) {
                    this.state.players.delete(sessionId);
                    this.serverPlayers.delete(sessionId);
                }
            });
            return;
        }

        const currentTotalCount = this.state.players.size;
        const desiredBotCount = TARGET_PLAYER_COUNT - humanPlayerCount;
        const currentBotCount = currentTotalCount - humanPlayerCount;

        if (currentBotCount < desiredBotCount) {
            // Add bots
            for (let i = 0; i < desiredBotCount - currentBotCount; i++) {
                const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
                this.addPlayer(botId, true);
            }
        } else if (currentBotCount > desiredBotCount) {
            // Remove bots
            let botsRemoved = 0;
            const botsToRemove = currentBotCount - desiredBotCount;
            this.state.players.forEach((player, sessionId) => {
                if (botsRemoved < botsToRemove && player.isAI) {
                    this.state.players.delete(sessionId);
                    this.serverPlayers.delete(sessionId);
                    botsRemoved++;
                }
            });
        }
    }

    onDispose() {
        console.log("room", this.roomId, "disposing...");
    }

    processPlayerInput(sessionId: string, delta: number) {
        const serverPlayer = this.serverPlayers.get(sessionId)!;
        const playerState = this.state.players.get(sessionId)!;
        const input = serverPlayer.input;

        let pitch = 0;
        let roll = 0;

        const isArcade = (input.joystick) || serverPlayer.controlStyle === 'arcade';

        if (input.joystick) {
            pitch = -input.joystick.y;
            roll = -input.joystick.x;
        } else {
            if (input.w) pitch = isArcade ? 1 : -1;
            if (input.s) pitch = isArcade ? -1 : 1;
            if (input.a) roll = 1;
            if (input.d) roll = -1;
        }
        
        // Invert pitch for arcade mode to be intuitive (up is up)
        if (isArcade) {
            pitch *= -1;
        }

        if (pitch !== 0) {
            serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PITCH_SPEED * pitch * delta));
        }
        if (roll !== 0) {
            serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_SPEED * roll * delta));
        }

        const speed = input.shift ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(serverPlayer.quaternion);
        serverPlayer.position.add(forward.multiplyScalar(speed * delta));

        serverPlayer.gunCooldown = Math.max(0, serverPlayer.gunCooldown - delta);
        serverPlayer.gunOverheat = Math.max(0, serverPlayer.gunOverheat - 15 * delta);
        playerState.gunOverheat = serverPlayer.gunOverheat;

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
                spawnTime: this.clock.currentTime,
                ownerId: sessionId
            });
        }
    }

    updateAI(sessionId: string, delta: number) {
        const serverPlayer = this.serverPlayers.get(sessionId)!;
        const now = this.clock.currentTime;
        
        // AI decision making
        if (now > serverPlayer.lastAiUpdate + AI_UPDATE_INTERVAL) {
            serverPlayer.lastAiUpdate = now;
            
            let closestTargetId: string | undefined;
            let minDistance = Infinity;

            this.state.players.forEach((otherPlayer, otherSessionId) => {
                if (otherSessionId === sessionId || otherPlayer.health <= 0) return;
                
                const otherServerPlayer = this.serverPlayers.get(otherSessionId)!;
                const distance = serverPlayer.position.distanceTo(otherServerPlayer.position);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestTargetId = otherSessionId;
                }
            });
            serverPlayer.targetId = closestTargetId;
        }
        
        const aiInput: any = { w: true }; // Always moving forward
        
        // --- Movement ---
        let targetDirection = new THREE.Vector3(0, 0, -1);
        const playerForward = new THREE.Vector3(0, 0, -1).applyQuaternion(serverPlayer.quaternion);

        // Obstacle avoidance takes priority
        if (serverPlayer.position.y < GROUND_Y + AI_AVOIDANCE_DISTANCE) {
            targetDirection.y = 0.5; // Pitch up
        } else if (Math.abs(serverPlayer.position.x) > BOUNDARY - AI_AVOIDANCE_DISTANCE || Math.abs(serverPlayer.position.z) > BOUNDARY - AI_AVOIDANCE_DISTANCE) {
            const centerDirection = new THREE.Vector3(0,0,0).sub(serverPlayer.position).normalize();
            targetDirection = centerDirection;
        } else if (serverPlayer.targetId) {
            const target = this.serverPlayers.get(serverPlayer.targetId);
            if (target && this.state.players.get(serverPlayer.targetId)?.health > 0) {
                 targetDirection = target.position.clone().sub(serverPlayer.position).normalize();
            } else {
                serverPlayer.targetId = undefined; // Target is dead or gone
            }
        }
        
        // Steer towards target direction
        const localTargetDirection = targetDirection.clone().applyQuaternion(serverPlayer.quaternion.clone().invert());
        
        if (localTargetDirection.x > 0.1) aiInput.a = true;
        else if (localTargetDirection.x < -0.1) aiInput.d = true;

        if (localTargetDirection.y > 0.1) aiInput.s = true;
        else if (localTargetDirection.y < -0.1) aiInput.w = true;

        // --- Shooting ---
        if (serverPlayer.targetId) {
            const target = this.serverPlayers.get(serverPlayer.targetId)!;
            const distanceToTarget = serverPlayer.position.distanceTo(target.position);
            const directionToTarget = target.position.clone().sub(serverPlayer.position).normalize();
            const angleDot = playerForward.dot(directionToTarget);

            if (distanceToTarget < AI_SHOOT_RANGE && angleDot > AI_SHOOT_ANGLE_THRESHOLD) {
                aiInput.mouse0 = true;
            }
        }

        serverPlayer.input = aiInput;
        this.processPlayerInput(sessionId, delta);
    }


    update(delta: number) {
        const now = this.clock.currentTime;

        // Process player and AI actions
        this.state.players.forEach((player, sessionId) => {
            const serverPlayer = this.serverPlayers.get(sessionId);
            if (!serverPlayer || player.health <= 0) return;

            if (player.isAI) {
                this.updateAI(sessionId, delta);
            } else {
                this.processPlayerInput(sessionId, delta);
            }

            // Common logic (physics, state sync)
            const updatedServerPlayer = this.serverPlayers.get(sessionId)!;
            player.x = updatedServerPlayer.position.x;
            player.y = updatedServerPlayer.position.y;
            player.z = updatedServerPlayer.position.z;
            player.qx = updatedServerPlayer.quaternion.x;
            player.qy = updatedServerPlayer.quaternion.y;
            player.qz = updatedServerPlayer.quaternion.z;
            player.qw = updatedServerPlayer.quaternion.w;
            
            // Boundary and altitude violation checks
            const inBoundaryViolation = Math.abs(player.x) > BOUNDARY || Math.abs(player.z) > BOUNDARY;
            const inAltitudeViolation = player.y > MAX_ALTITUDE;

            if (inBoundaryViolation) serverPlayer.boundaryTimer = Math.max(0, serverPlayer.boundaryTimer - delta);
            else serverPlayer.boundaryTimer = 7;
            
            if (inAltitudeViolation) serverPlayer.altitudeTimer = Math.max(0, serverPlayer.altitudeTimer - delta);
            else serverPlayer.altitudeTimer = 5;

            const terrainHitboxMesh = new THREE.Mesh(TERRAIN_COLLISION_GEOMETRY);
            terrainHitboxMesh.position.copy(serverPlayer.position);
            terrainHitboxMesh.quaternion.copy(serverPlayer.quaternion);
            const playerTerrainHitbox = this.createScaledBox(terrainHitboxMesh, 0.8);
            
            let hasCrashed = false;
            for (const obstacle of this.collidableObjects) {
                if (playerTerrainHitbox.intersectsBox(obstacle)) {
                    hasCrashed = true;
                    break;
                }
            }
            
            if (hasCrashed || serverPlayer.boundaryTimer <= 0 || serverPlayer.altitudeTimer <= 0) {
                if (player.health > 0) player.health = 0;
            }

            if (player.health <= 0 && !player.isAI) {
                // Handle human player death (no automatic respawn)
            } else if(player.health <= 0 && player.isAI) {
                this.clock.setTimeout(() => this.respawnPlayer(sessionId), 3000);
            }
        });

        const playerHitboxes: Map<string, { hitbox: THREE.Box3, player: Player }> = new Map();
        this.state.players.forEach((p, id) => {
            const serverPlayer = this.serverPlayers.get(id);
            if(serverPlayer && p.health > 0) {
                const bulletHitboxMesh = new THREE.Mesh(BULLET_COLLISION_GEOMETRY);
                bulletHitboxMesh.position.copy(serverPlayer.position);
                bulletHitboxMesh.quaternion.copy(serverPlayer.quaternion);
                const hitbox = this.createScaledBox(bulletHitboxMesh, 1.0);
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

            for (const [targetId, targetData] of playerHitboxes.entries()) {
                if (targetId === bullet.ownerId) continue;
                
                if (targetData.hitbox.containsPoint(bullet.position)) {
                    targetData.player.health -= BULLET_DAMAGE;

                    if (targetData.player.health <= 0) {
                        targetData.player.health = 0;
                        const shooter = this.state.players.get(bullet.ownerId);
                        if (shooter) shooter.kills++;
                    }

                    this.serverBullets.delete(bulletId);
                    this.state.bullets.delete(bulletId);
                    break;
                }
            }
        });
    }
}
