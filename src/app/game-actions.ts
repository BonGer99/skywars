// src/app/game-actions.ts
'use server';

import * as gameState from '@/lib/game-state';
import type { PlayerInput } from '@/lib/game-state';

export async function joinServer(serverId: string, playerName: string) {
  const { player, playerId } = gameState.addPlayer(serverId, playerName);
  
  // The full player object contains THREE.js Vector3 and Quaternion objects.
  // These are not "plain objects" and cannot be passed from Server Actions
  // to Client Components. We need to serialize them into a plain object.
  const serializablePlayer = {
    id: player.id,
    name: player.name,
    health: player.health,
    kills: player.kills,
    position: player.position.toArray(),
    quaternion: player.quaternion.toArray(),
    isAI: player.isAI,
  };

  return { player: serializablePlayer, playerId };
}

export async function leaveServer(serverId: string, playerId: string) {
  gameState.removePlayer(serverId, playerId);
}

export async function sendInput(
  serverId: string,
  playerId: string,
  input: PlayerInput
) {
  gameState.updatePlayerInput(serverId, playerId, input);
}

export async function fireBullet(
    serverId: string,
    playerId: string,
    bullet: { position: {x:number, y:number, z:number}; quaternion: {x:number, y:number, z:number, w:number} }
) {
    gameState.addBullet(serverId, playerId, bullet);
}

export async function getFullState(serverId: string) {
  return gameState.getGameState(serverId);
}

export async function getServerList() {
    return gameState.getServers();
}

export async function getPlayerCount(serverId: string) {
    return gameState.getPlayerCount(serverId);
}
