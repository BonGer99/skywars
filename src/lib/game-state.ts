
// WARNING: This is a simplified in-memory store for a prototype.
// In a real production environment with multiple server instances or serverless cold starts,
// this state would be lost or become inconsistent.
// A distributed cache like Redis or a dedicated stateful service would be required for a full-scale application.

import * as THREE from 'three';
import { generateOpponentBehavior, type OpponentBehaviorOutput } from '@/ai/flows/ai-opponent-behavior';

// Constants
const BASE_SPEED = 60;
const BOOST_MULTIPLIER = 2.0;
const PITCH_SPEED = 1.2;
const ROLL_SPEED = 1.8;
const YAW_SPEED = 1.0;
const MAX_ALTITUDE = 220;
const BOUNDARY = 950;
const GROUND_Y = -50;
const BULLET_SPEED = 200;
const BULLET_LIFESPAN_MS = 5000;
const PLAYER_HEALTH = 100;
const TARGET_PLAYER_COUNT = 8;
const AI_SHOOTING_RANGE = 500;
const AI_SHOOTING_COOLDOWN = 1.5; // seconds

export type PlayerInput = {
  w: boolean;
  s: boolean;
  a: boolean;
  d: boolean;
  shift: boolean;
  space: boolean;
  mouse0: boolean;
};

type Player = {
  id: string;
  name: string;
  health: number;
  kills: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  input: PlayerInput;
  gunCooldown: number;
  gunOverheat: number;
  isAI: boolean;
  behavior?: OpponentBehaviorOutput | null;
  nextBehaviorUpdate?: number;
  targetPosition?: THREE.Vector3;
  targetPlayerId?: string | null;
  lastUpdateTime: number;
};

type Bullet = {
  id: string;
  ownerId: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spawnTime: number;
};

type GameState = {
  players: Record<string, Player>;
  bullets: Record<string, Bullet>;
  lastUpdate: number;
};

type ServerInfo = {
  id: string;
  name: string;
  region: string;
  maxPlayers: number;
};

// In-memory store
const gameStates: Record<string, GameState> = {};
const servers: Record<string, ServerInfo> = {
    'europe-server': { id: 'europe-server', name: 'Aces High - Europe', region: 'Europe', maxPlayers: 24 },
};

function initializeGameState(serverId: string) {
  if (!gameStates[serverId]) {
    gameStates[serverId] = {
      players: {},
      bullets: {},
      lastUpdate: Date.now(),
    };
  }
}

// Public API for server actions
export function getServers() {
    return Object.values(servers).map(server => ({
        ...server,
        playerCount: getPlayerCount(server.id)
    }));
}

export function getPlayerCount(serverId: string): number {
  initializeGameState(serverId);
  // We only count human players for the lobby list
  return Object.values(gameStates[serverId].players).filter(p => !p.isAI).length;
}

export function addPlayer(serverId: string, playerName: string) {
  initializeGameState(serverId);
  
  const playerId = Math.random().toString(36).substring(2, 15);
  const position = new THREE.Vector3((Math.random() - 0.5) * 500, 50, (Math.random() - 0.5) * 500);
  const quaternion = new THREE.Quaternion();

  const player: Player = {
    id: playerId,
    name: playerName,
    health: PLAYER_HEALTH,
    kills: 0,
    position,
    quaternion,
    input: { w: false, s: false, a: false, d: false, shift: false, space: false, mouse0: false },
    gunCooldown: 0,
    gunOverheat: 0,
    isAI: false,
    lastUpdateTime: Date.now()
  };

  gameStates[serverId].players[playerId] = player;
  return { player, playerId };
}

export function removePlayer(serverId: string, playerId: string) {
  if (gameStates[serverId]?.players[playerId]) {
    delete gameStates[serverId].players[playerId];
  }
}

export function updatePlayerInput(serverId: string, playerId: string, input: PlayerInput) {
  const player = gameStates[serverId]?.players[playerId];
  if (player) {
    player.input = input;
    player.lastUpdateTime = Date.now();
  }
}

export function addBullet(serverId: string, playerId: string, bulletData: { position: {x:number, y:number, z:number}; quaternion: {x:number, y:number, z:number, w:number} }) {
    if(!gameStates[serverId]) return;
    
    const bulletId = Math.random().toString(36).substring(2, 15);
    const velocity = new THREE.Vector3(0, 0, -BULLET_SPEED).applyQuaternion(new THREE.Quaternion(bulletData.quaternion.x, bulletData.quaternion.y, bulletData.quaternion.z, bulletData.quaternion.w));
    
    const bullet: Bullet = {
        id: bulletId,
        ownerId: playerId,
        position: new THREE.Vector3(bulletData.position.x, bulletData.position.y, bulletData.position.z),
        velocity: velocity,
        spawnTime: Date.now()
    };
    
    gameStates[serverId].bullets[bulletId] = bullet;
}


export function getGameState(serverId: string) {
    if (!gameStates[serverId]) {
        return { players: {}, bullets: {} };
    }
    const { players, bullets } = gameStates[serverId];
    
    // Flatten data for serialization
    const serializablePlayers = Object.fromEntries(
        Object.entries(players).map(([id, p]) => [id, {
            id: p.id,
            name: p.name,
            health: p.health,
            kills: p.kills,
            position: p.position.toArray(),
            quaternion: p.quaternion.toArray(),
            isAI: p.isAI
        }])
    );

    const serializableBullets = Object.fromEntries(
        Object.entries(bullets).map(([id, b]) => [id, {
            id: b.id,
            ownerId: b.ownerId,
            position: b.position.toArray(),
        }])
    );
    
    return { players: serializablePlayers, bullets: serializableBullets };
}

// Game Logic Loop
function updateGame() {
  const now = Date.now();
  for (const serverId in gameStates) {
    const state = gameStates[serverId];
    const delta = (now - state.lastUpdate) / 1000;
    state.lastUpdate = now;

    manageAIPopulation(serverId);

    // Update players
    for (const playerId in state.players) {
      const player = state.players[playerId];

      // Prune stale players
      if(now - player.lastUpdateTime > 20000 && !player.isAI) {
        removePlayer(serverId, playerId);
        continue;
      }

      if (player.isAI) {
        updateAI(player, state, delta);
      } else {
        updatePlayer(player, delta);
      }

      // Check boundary conditions and respawn dead players
      if (player.health <= 0) {
        if(player.isAI) {
            player.health = PLAYER_HEALTH;
            player.position.set((Math.random() - 0.5) * 1500, Math.random() * 100 + 50, (Math.random() - 0.5) * 1500);
        }
      } else if (player.position.y - GROUND_Y < 0 || Math.abs(player.position.x) > BOUNDARY || Math.abs(player.position.z) > BOUNDARY || player.position.y > MAX_ALTITUDE) {
        player.health = 0;
      }
    }

    // Update bullets and check for collisions
    const playerHitboxes: Record<string, THREE.Box3> = {};
    for (const pId in state.players) {
        const p = state.players[pId];
        const playerPlaneGeo = new THREE.BoxGeometry(9, 3, 5); // Matching client-side hitbox
        playerHitboxes[pId] = new THREE.Box3().setFromObject(new THREE.Mesh(playerPlaneGeo, new THREE.MeshBasicMaterial())).applyMatrix4(new THREE.Matrix4().compose(p.position, p.quaternion, new THREE.Vector3(1,1,1)));
    }


    for (const bulletId in state.bullets) {
      const bullet = state.bullets[bulletId];
      bullet.position.add(bullet.velocity.clone().multiplyScalar(delta));

      if (now - bullet.spawnTime > BULLET_LIFESPAN_MS) {
        delete state.bullets[bulletId];
        continue;
      }

      for(const targetId in state.players) {
          if (targetId === bullet.ownerId) continue; // Can't shoot self
          
          const target = state.players[targetId];
          const targetHitbox = playerHitboxes[targetId];

          if (target.health > 0 && targetHitbox.containsPoint(bullet.position)) {
              target.health -= 10;
              if (target.health <= 0) {
                  target.health = 0;
                  const shooter = state.players[bullet.ownerId];
                  if (shooter) {
                      shooter.kills++;
                  }
              }
              delete state.bullets[bulletId];
              break; 
          }
      }
    }
  }
}

function updatePlayer(player: Player, delta: number) {
  if (player.health <= 0) return;
  const input = player.input;
  
  if (input.w) player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -PITCH_SPEED * delta));
  if (input.s) player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PITCH_SPEED * delta));
  if (input.a) {
    player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_SPEED * delta));
    player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAW_SPEED * delta * 0.2));
  }
  if (input.d) {
    player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ROLL_SPEED * delta));
    player.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -YAW_SPEED * delta * 0.2));
  }
  
  const speed = input.shift ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
  player.position.add(forward.multiplyScalar(speed * delta));

  player.gunCooldown = Math.max(0, player.gunCooldown - delta);
  player.gunOverheat = Math.max(0, player.gunOverheat - 15 * delta);

  if ((input.space || input.mouse0) && player.gunCooldown <= 0 && player.gunOverheat < 100) {
    player.gunCooldown = 0.1;
    player.gunOverheat += 5;
    // Bullet creation is handled by the client sending an action
  }
}


function manageAIPopulation(serverId: string) {
    const state = gameStates[serverId];
    if(!state) return;

    const humanPlayerCount = Object.values(state.players).filter(p => !p.isAI).length;
    const aiPlayerCount = Object.values(state.players).filter(p => p.isAI).length;
    const totalPlayers = humanPlayerCount + aiPlayerCount;

    if (totalPlayers < TARGET_PLAYER_COUNT) {
        const numAIToAdd = TARGET_PLAYER_COUNT - totalPlayers;
        for (let i = 0; i < numAIToAdd; i++) {
            const aiId = `ai_${Math.random().toString(36).substring(2, 9)}`;
            state.players[aiId] = {
                id: aiId,
                name: `AI Pilot ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random()*100)}`,
                health: 100,
                kills: 0,
                position: new THREE.Vector3((Math.random() - 0.5) * 1500, Math.random() * 100 + 50, (Math.random() - 0.5) * 1500),
                quaternion: new THREE.Quaternion(),
                input: { w: false, s: false, a: false, d: false, shift: false, space: false, mouse0: false },
                gunCooldown: Math.random() * 2,
                gunOverheat: 0,
                isAI: true,
                behavior: null,
                nextBehaviorUpdate: 0,
                targetPosition: new THREE.Vector3(),
                targetPlayerId: null,
                lastUpdateTime: Date.now()
            };
        }
    } else if (humanPlayerCount > 0 && totalPlayers > TARGET_PLAYER_COUNT) {
        // Only remove AI if humans are present and we are over target
        const numAIToRemove = totalPlayers - TARGET_PLAYER_COUNT;
        const aiToRemove = Object.values(state.players).filter(p => p.isAI).slice(0, numAIToRemove);
        aiToRemove.forEach(ai => {
            delete state.players[ai.id];
        });
    } else if (humanPlayerCount === 0 && aiPlayerCount > 0) {
        // If all humans leave, clear out all the AI.
        Object.values(state.players).filter(p => p.isAI).forEach(ai => {
            delete state.players[ai.id];
        });
    }
}


function updateAI(ai: Player, state: GameState, delta: number) {
    if (ai.health <= 0) return;
    const now = Date.now();
    const allPlayers = Object.values(state.players);

    // AI decision making (every few seconds)
    if (now > (ai.nextBehaviorUpdate ?? 0)) {
        ai.nextBehaviorUpdate = now + (3 + Math.random() * 4) * 1000;
        
        const humanPlayers = allPlayers.filter(p => !p.isAI && p.health > 0);
        
        if (humanPlayers.length > 0) {
            // Find the closest human player
            let closestPlayer: Player | null = null;
            let minDistance = Infinity;
            for(const player of humanPlayers) {
                const distance = ai.position.distanceTo(player.position);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPlayer = player;
                }
            }
            ai.targetPlayerId = closestPlayer!.id;
        } else {
            ai.targetPlayerId = null;
            // No humans, fly to a random point
            if(!ai.targetPosition || ai.position.distanceTo(ai.targetPosition) < 200) {
                ai.targetPosition = new THREE.Vector3((Math.random() - 0.5) * 1800, Math.random() * 150 + 50, (Math.random() - 0.5) * 1800);
            }
        }
    }
    
    // AI action
    const targetPlayer = ai.targetPlayerId ? state.players[ai.targetPlayerId] : null;
    const targetPosition = targetPlayer ? targetPlayer.position : ai.targetPosition;

    if (targetPosition) {
        const direction = new THREE.Vector3().subVectors(targetPosition, ai.position).normalize();
        const idealQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
        ai.quaternion.slerp(idealQuaternion, 0.05);
    }
    
    const speed = BASE_SPEED * 0.8; // AI are slightly slower
    ai.position.add(new THREE.Vector3(0, 0, -1).applyQuaternion(ai.quaternion).multiplyScalar(speed * delta));

    // AI Shooting
    ai.gunCooldown = Math.max(0, ai.gunCooldown - delta);
    if (targetPlayer && ai.gunCooldown <= 0) {
        const distanceToTarget = ai.position.distanceTo(targetPlayer.position);
        const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(ai.quaternion);
        const directionToTarget = new THREE.Vector3().subVectors(targetPlayer.position, ai.position).normalize();
        const angle = forwardVector.angleTo(directionToTarget);

        // Check if target is in front and in range
        if (angle < 0.3 && distanceToTarget < AI_SHOOTING_RANGE) { 
            addBullet(Object.keys(servers)[0], ai.id, { position: ai.position, quaternion: ai.quaternion });
            ai.gunCooldown = AI_SHOOTING_COOLDOWN;
        }
    }
}


// Start the server-side game loop
setInterval(updateGame, 50); // 20 times per second

    