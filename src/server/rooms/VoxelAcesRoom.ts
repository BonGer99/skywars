import { Room, Client } from "@colyseus/core";
import { VoxelAcesState, Player, Bullet, LeaderboardEntry } from "./state/VoxelAcesState";
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
const AI_SHOOT_ANGLE_THRESHOLD = 0.95; // cos(angle), higher is more accurate

const TERRAIN_COLLISION_GEOMETRY = new THREE.BoxGeometry(1.5, 1.2, 4);
const BULLET_COLLISION_GEOMETRY = new THREE.BoxGeometry(12, 3, 6); // Increased size for easier bullet collision

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
    isDescendingFromAltitude: boolean;
    flyByTimer: number; // Timer for AI fly-by behavior
    invulnerabilityTimer: number;
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

        this.onMessage("player_ready", (client) => {
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
        try {
            const validOptions = options && typeof options === 'object' ? options : {};

            const playerName = (typeof validOptions.playerName === 'string' && validOptions.playerName.trim().length > 0)
                ? validOptions.playerName.trim().substring(0, 16)
                : "Pilot";
            
            const controlStyle = (validOptions.controlStyle === 'realistic' || validOptions.controlStyle === 'arcade')
                ? validOptions.controlStyle
                : 'arcade';
    
            this.addPlayer(client.sessionId, false, { playerName, controlStyle });
            
            this.checkBotPopulation();
            this.updateLeaderboard();

        } catch (e) {
            console.error(`[VoxelAcesRoom] FATAL: Crash in onJoin for client ${client.sessionId}:`, e);
        }
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left!");
        this.state.players.delete(client.sessionId);
        this.serverPlayers.delete(client.sessionId);
        this.checkBotPopulation();
        this.updateLeaderboard();
    }
    
    addPlayer(sessionId: string, isAI: boolean, options: { playerName: string, controlStyle: ControlStyle }) {
        const player = new Player();
        
        player.name = isAI ? `Bot ${this.botNames[Math.floor(Math.random() * this.botNames.length)]}` : options.playerName;
        player.isAI = isAI;
        player.health = PLAYER_HEALTH; // Set health to full initially to avoid client-side race condition.
        player.gunOverheat = 0;
        player.isReady = false;

        this.state.players.set(sessionId, player);

        this.serverPlayers.set(sessionId, {
            position: new THREE.Vector3(0, 10000, 0),
            quaternion: new THREE.Quaternion(),
            input: {},
            gunCooldown: 0,
            gunOverheat: 0,
            boundaryTimer: 7,
            altitudeTimer: 5,
            controlStyle: isAI ? 'arcade' : options.controlStyle,
            isAI: isAI,
            lastAiUpdate: 0,
            isDescendingFromAltitude: false,
            flyByTimer: 0,
            invulnerabilityTimer: 0
        });

        if (isAI) {
            this.respawnPlayer(sessionId);
        }
    }
    
    respawnPlayer(sessionId: string) {
        const playerState = this.state.players.get(sessionId);
        const serverPlayer = this.serverPlayers.get(sessionId);

        if (playerState && serverPlayer) {
            playerState.health = PLAYER_HEALTH;
            if(playerState.isAI) {
                playerState.kills = 0;
            }
            
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
            serverPlayer.isDescendingFromAltitude = false;
            serverPlayer.flyByTimer = 0;
            serverPlayer.invulnerabilityTimer = 3;

            playerState.isReady = true;
            this.updateLeaderboard();
        }
    }

    checkBotPopulation() {
        const humanPlayerCount = this.clients.length;

        if (humanPlayerCount === 0) {
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
            for (let i = 0; i < desiredBotCount - currentBotCount; i++) {
                const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
                this.addPlayer(botId, true, { playerName: 'Bot', controlStyle: 'arcade' });
            }
        } else if (currentBotCount > desiredBotCount) {
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

    updateLeaderboard() {
        const sortedPlayers = Array.from(this.state.players.entries())
            .sort(([, a], [, b]) => b.kills - a.kills)
            .slice(0, 5); // Limit to top 5

        this.state.leaderboard.clear();
        sortedPlayers.forEach(([id, player]) => {
            const entry = new LeaderboardEntry();
            entry.id = id;
            entry.name = player.name;
            entry.kills = player.kills;
            this.state.leaderboard.push(entry);
        });
    }

    processPlayerInput(sessionId: string, delta: number) {
        const serverPlayer = this.serverPlayers.get(sessionId)!;
        const playerState = this.state.players.get(sessionId)!;
        const input = serverPlayer.input;

        let pitch = 0;
        let roll = 0;
        
        const useJoystick = !!input.joystick;

        if (useJoystick) {
            pitch = -input.joystick.y * PITCH_SPEED;
            roll = -input.joystick.x * ROLL_SPEED;
        } else {
             if (input.w) pitch = 1;
             if (input.s) pitch = -1;
             if (input.a) roll = 1;
             if (input.d) roll = -1;
        }
        
        // In "realistic" flight sims, pushing stick forward (UP) makes plane go down.
        // So we invert the pitch.
        if (serverPlayer.controlStyle === 'realistic' && !useJoystick) {
            pitch *= -1;
        }
        
        if (pitch !== 0) {
            const pitchSpeed = PITCH_SPEED;
            serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchSpeed * pitch * delta));
        }
        if (roll !== 0) {
            const rollSpeed = ROLL_SPEED;
            serverPlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollSpeed * roll * delta));
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
        const aiInput: any = {};

        serverPlayer.flyByTimer = Math.max(0, serverPlayer.flyByTimer - delta);
        
        if (now > serverPlayer.lastAiUpdate + AI_UPDATE_INTERVAL) {
            serverPlayer.lastAiUpdate = now;
            
            let closestTargetId: string | undefined;
            let minDistance = Infinity;

            this.state.players.forEach((otherPlayer, otherSessionId) => {
                if (otherSessionId === sessionId || !otherPlayer.isReady || otherPlayer.health <= 0 || otherPlayer.isAI) return; // AI only targets human players
                
                const otherServerPlayer = this.serverPlayers.get(otherSessionId)!;
                const distance = serverPlayer.position.distanceTo(otherServerPlayer.position);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestTargetId = otherSessionId;
                }
            });
            serverPlayer.targetId = closestTargetId;
        }
        
        let targetDirection: THREE.Vector3;
        const playerForward = new THREE.Vector3(0, 0, -1).applyQuaternion(serverPlayer.quaternion);

        // AI Priorities: 1. Survival (Ceiling/Ground/Bounds), 2. Combat
        
        // Priority 1a: Ceiling avoidance
        if (serverPlayer.position.y > MAX_ALTITUDE) {
            serverPlayer.isDescendingFromAltitude = true;
        }
        if (serverPlayer.position.y < MAX_ALTITUDE - 50) { // Give a buffer before it stops forced descent
             serverPlayer.isDescendingFromAltitude = false;
        }

        if (serverPlayer.isDescendingFromAltitude) {
            targetDirection = new THREE.Vector3(playerForward.x, -0.7, playerForward.z).normalize();
        } 
        // Priority 1b: Ground avoidance
        else if (serverPlayer.position.y < GROUND_Y + AI_AVOIDANCE_DISTANCE) {
            targetDirection = new THREE.Vector3(playerForward.x, 0.5, playerForward.z).normalize();
        } 
        // Priority 1c: Boundary avoidance
        else if (Math.abs(serverPlayer.position.x) > BOUNDARY - AI_AVOIDANCE_DISTANCE || Math.abs(serverPlayer.position.z) > BOUNDARY - AI_AVOIDANCE_DISTANCE) {
            const centerDirection = new THREE.Vector3(0, serverPlayer.position.y, 0).sub(serverPlayer.position).normalize();
            targetDirection = centerDirection;
        }
        // Priority 2: Combat
        else if (serverPlayer.targetId) {
            const target = this.serverPlayers.get(serverPlayer.targetId!);
            if (target && this.state.players.get(serverPlayer.targetId)?.health > 0) {
                 targetDirection = target.position.clone().sub(serverPlayer.position).normalize();
            } else {
                 targetDirection = playerForward; // No valid target, fly straight
            }
        } else {
             targetDirection = playerForward; // No target, fly straight
        }
        
        const localTargetDirection = targetDirection.clone().applyQuaternion(serverPlayer.quaternion.clone().invert());
        
        if (localTargetDirection.x > 0.1) aiInput.d = true;
        else if (localTargetDirection.x < -0.1) aiInput.a = true;

        if (localTargetDirection.y > 0.1) aiInput.w = true; 
        else if (localTargetDirection.y < -0.1) aiInput.s = true;

        // AI Shooting logic
        if (serverPlayer.targetId && serverPlayer.flyByTimer <= 0 && !serverPlayer.isDescendingFromAltitude) {
            const target = this.serverPlayers.get(serverPlayer.targetId)!;
            const distanceToTarget = serverPlayer.position.distanceTo(target.position);
            const directionToTarget = target.position.clone().sub(serverPlayer.position).normalize();
            const angleDot = playerForward.dot(directionToTarget);

            if (distanceToTarget < AI_SHOOT_RANGE && angleDot > AI_SHOOT_ANGLE_THRESHOLD) {
                aiInput.mouse0 = true;
                if (distanceToTarget < AI_SHOOT_RANGE * 0.8) {
                    serverPlayer.flyByTimer = 2;
                }
            }
        }

        serverPlayer.input = aiInput;
        this.processPlayerInput(sessionId, delta);
    }


    update(delta: number) {
        const now = this.clock.currentTime;

        this.state.players.forEach((player, sessionId) => {
            const serverPlayer = this.serverPlayers.get(sessionId);

            if (!serverPlayer || !player.isReady || player.health <= 0) {
                return;
            }

            serverPlayer.invulnerabilityTimer = Math.max(0, serverPlayer.invulnerabilityTimer - delta);

            if (player.isAI) {
                this.updateAI(sessionId, delta);
            } else {
                this.processPlayerInput(sessionId, delta);
            }

            const updatedServerPlayer = this.serverPlayers.get(sessionId)!;
            player.x = updatedServerPlayer.position.x;
            player.y = updatedServerPlayer.position.y;
            player.z = updatedServerPlayer.position.z;
            player.qx = updatedServerPlayer.quaternion.x;
            player.qy = updatedServerPlayer.quaternion.y;
            player.qz = updatedServerPlayer.quaternion.z;
            player.qw = updatedServerPlayer.quaternion.w;
            
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
            if (serverPlayer.invulnerabilityTimer <= 0) {
                 for (const obstacle of this.collidableObjects) {
                    if (playerTerrainHitbox.intersectsBox(obstacle)) {
                        hasCrashed = true;
                        break;
                    }
                }
            }
            
            if (hasCrashed || serverPlayer.boundaryTimer <= 0 || serverPlayer.altitudeTimer <= 0) {
                if (player.health > 0) player.health = 0;
            }

            if (player.health <= 0) {
                player.isReady = false; 
                if(player.isAI) {
                     this.clock.setTimeout(() => this.respawnPlayer(sessionId), 5000);
                }
            }
        });

        const playerHitboxes: Map<string, { hitbox: THREE.Box3, player: Player, serverPlayer: ServerPlayerData }> = new Map();
        this.state.players.forEach((p, id) => {
            const serverPlayer = this.serverPlayers.get(id);
            if(serverPlayer && p.isReady && p.health > 0) {
                const bulletHitboxMesh = new THREE.Mesh(BULLET_COLLISION_GEOMETRY);
                bulletHitboxMesh.position.copy(serverPlayer.position);
                bulletHitboxMesh.quaternion.copy(serverPlayer.quaternion);
                const hitbox = this.createScaledBox(bulletHitboxMesh, 1.0);
                playerHitboxes.set(id, { hitbox, player: p, serverPlayer });
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
                if (targetId === bullet.ownerId || targetData.serverPlayer.invulnerabilityTimer > 0) continue;
                
                if (targetData.hitbox.containsPoint(bullet.position)) {
                    targetData.player.health -= BULLET_DAMAGE;

                    if (targetData.player.health <= 0) {
                        targetData.player.health = 0;
                        const shooter = this.state.players.get(bullet.ownerId);
                        if (shooter) {
                            shooter.kills++;
                            this.updateLeaderboard();
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
