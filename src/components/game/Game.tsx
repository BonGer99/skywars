
'use client';

import * as THREE from 'three';
import * as Colyseus from 'colyseus.js';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LocateFixed } from 'lucide-react';
import type { VoxelAcesState, Player, LeaderboardEntry } from '@/server/rooms/state/VoxelAcesState';
import { useSettings } from '@/context/SettingsContext';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { generateOpponentBehavior, OpponentBehaviorOutput } from '@/ai/flows/ai-opponent-behavior';

// Constants
const WORLD_SEED = 12345;
const BOUNDARY = 950;
const MAX_ALTITUDE = 220;
const GROUND_Y = -50;
const BASE_SPEED = 60;
const BOOST_MULTIPLIER = 2.0;
const PITCH_SPEED = 1.5;
const ROLL_SPEED = 2.5;
const BULLET_SPEED = 200;
const BULLET_LIFESPAN_MS = 5000;
const INTERPOLATION_FACTOR = 0.05;
const TERRAIN_COLLISION_GEOMETRY = new THREE.BoxGeometry(1.5, 1.2, 4);
const BULLET_COLLISION_GEOMETRY = new THREE.BoxGeometry(8, 2, 4);
const OFFLINE_SPAWN_POS = new THREE.Vector3(200, 50, 200);

// Offline Mode Types
type OfflineEnemy = {
    id: string;
    mesh: THREE.Group;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    health: number;
    behavior: OpponentBehaviorOutput;
    gunCooldown: number;
};
type PlayerPerformance = {
    shotsFired: number;
    shotsHit: number;
    damageTaken: number;
    waveStartTime: number;
    totalPlayTime: number;
};
type BulletRef = {
    id: string;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    spawnTime: number;
    mesh: THREE.Mesh;
};


const createVoxelPlane = (color: THREE.ColorRepresentation) => {
    const plane = new THREE.Group();
    const visualGroup = new THREE.Group();
    plane.add(visualGroup);
    
    const bodyMat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 4), bodyMat);
    visualGroup.add(body);

    const wings = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 1.5), bodyMat);
    wings.position.y = 0.2;
    visualGroup.add(wings);
    
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1), bodyMat);
    tail.position.set(0, 0.2, -2.5);
    visualGroup.add(tail);
    
    const cockpitGeo = new THREE.BoxGeometry(0.8, 0.6, 1);
    const cockpitMat = new THREE.MeshLambertMaterial({ color: 0x000000, flatShading: true });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.8, -0.5);
    visualGroup.add(cockpit);

    return plane;
};


const OnScreenControls = ({ joystickInput, keysPressed }: {
    joystickInput: React.MutableRefObject<{ x: number, y: number }>;
    keysPressed: React.MutableRefObject<Record<string, boolean>> 
}) => {
    const [joystick, setJoystick] = useState<{
        active: boolean;
        base: { x: number; y: number };
        stick: { x: number; y: number };
    } | null>(null);

    const joystickZoneRef = useRef<HTMLDivElement>(null);

    const handleJoystickStart = (e: React.TouchEvent<HTMLDivElement>) => {
        const touch = e.touches[0];
        e.preventDefault();
        setJoystick({
            active: true,
            base: { x: touch.clientX, y: touch.clientY },
            stick: { x: touch.clientX, y: touch.clientY },
        });
    };

    const handleJoystickMove = (e: React.TouchEvent<HTMLDivElement>) => {
        if (joystick?.active) {
            e.preventDefault();
            const touch = e.touches[0];
            const maxDistance = 60;
            const deltaX = touch.clientX - joystick.base.x;
            const deltaY = touch.clientY - joystick.base.y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const angle = Math.atan2(deltaY, deltaX);

            const stickDistance = Math.min(distance, maxDistance);
            const stickX = joystick.base.x + stickDistance * Math.cos(angle);
            const stickY = joystick.base.y + stickDistance * Math.sin(angle);

            setJoystick({ ...joystick, stick: { x: stickX, y: stickY } });

            const deadzone = 0.1;
            let inputX = (stickX - joystick.base.x) / maxDistance;
            let inputY = (stickY - joystick.base.y) / maxDistance;

            if (Math.abs(inputX) < deadzone) inputX = 0;
            if (Math.abs(inputY) < deadzone) inputY = 0;
            
            joystickInput.current = { x: inputX, y: inputY };
        }
    };

    const handleJoystickEnd = (e: React.TouchEvent<HTMLDivElement>) => {
        if (joystick?.active) {
            e.preventDefault();
            setJoystick(null);
            joystickInput.current = { x: 0, y: 0 };
        }
    };

    const handleActionTouch = (key: string, isPressed: boolean) => (event: React.TouchEvent) => {
        event.preventDefault();
        keysPressed.current[key] = isPressed;
    };

    return (
        <div className="fixed inset-0 z-30 pointer-events-none text-white select-none">
            {/* Prevent browser default touch behaviors */}
            <style jsx global>{`
              body {
                touch-action: none;
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                -khtml-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
                overscroll-behavior: none;
              }
            `}</style>
            
            {/* Joystick Control Zone (Left half) */}
            <div
                ref={joystickZoneRef}
                className="absolute top-0 left-0 w-1/2 h-full pointer-events-auto"
                onTouchStart={handleJoystickStart}
                onTouchMove={handleJoystickMove}
                onTouchEnd={handleJoystickEnd}
            />
            
            {/* Joystick Visuals */}
            {joystick?.active && (
                <div className="fixed inset-0 z-30 pointer-events-none">
                    <div
                        className="absolute bg-black/30 rounded-full w-32 h-32 backdrop-blur-sm"
                        style={{ left: joystick.base.x - 64, top: joystick.base.y - 64 }}
                    />
                    <div
                        className="absolute bg-black/50 rounded-full w-16 h-16 border-2 border-white/50"
                        style={{ left: joystick.stick.x - 32, top: joystick.stick.y - 32 }}
                    />
                </div>
            )}

            {/* Action Controls (Bottom Right) */}
            <div className="absolute bottom-8 right-8 flex flex-col gap-4 items-center pointer-events-auto z-40">
                <button onTouchStart={handleActionTouch('mouse0', true)} onTouchEnd={handleActionTouch('mouse0', false)} className="bg-red-600/60 rounded-full w-16 h-16 flex items-center justify-center backdrop-blur-sm active:bg-red-600/80">
                     <LocateFixed size={28} />
                </button>
            </div>
        </div>
    );
};

type GameMode = 'offline' | 'online';
type OfflineGameStatus = 'menu' | 'playing' | 'gameover';
type OnlineGameStatus = 'loading' | 'ready' | 'playing' | 'gameover';


interface GameProps {
  mode: GameMode;
  playerName?: string;
}

export default function Game({ mode, playerName: playerNameProp }: GameProps) {
    const mountRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const roomRef = useRef<Colyseus.Room<VoxelAcesState> | null>(null);
    const isConnectingRef = useRef(false);
    
    const keysPressed = useRef<Record<string, boolean>>({});
    const joystickInput = useRef({ x: 0, y: 0 });

    // Core game state refs
    const sceneRef = useRef<THREE.Scene | null>(null);
    const offlinePlayerRef = useRef({
        position: new THREE.Vector3().copy(OFFLINE_SPAWN_POS),
        quaternion: new THREE.Quaternion(),
        gunCooldown: 0,
        gunOverheat: 0,
        health: 100
    });
    const localOfflineBulletsRef = useRef<BulletRef[]>([]);
    const offlineEnemiesRef = useRef<OfflineEnemy[]>([]);
    const offlineEnemyBulletsRef = useRef<BulletRef[]>([]);
    const playerPerformanceRef = useRef<PlayerPerformance>({ shotsFired: 0, shotsHit: 0, damageTaken: 0, waveStartTime: 0, totalPlayTime: 0 });
    
    // UI State
    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(0);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [altitude, setAltitude] = useState(0);
    const [gunOverheat, setGunOverheat] = useState(0);
    const { onScreenControls, controlStyle } = useSettings();
    const isMobile = useIsMobile();
    
    const offlineGameStatusRef = useRef<OfflineGameStatus>(mode === 'offline' ? 'menu' : 'playing');
    
    const [showAltitudeWarning, setShowAltitudeWarning] = useState(false);
    const altitudeWarningTimerRef = useRef(5);

    const [showBoundaryWarning, setShowBoundaryWarning] = useState(false);
    const boundaryWarningTimerRef = useRef(7);
    
    const [whiteoutOpacity, setWhiteoutOpacity] = useState(0);

    const getGameStatus = (): OnlineGameStatus | OfflineGameStatus => {
        const room = roomRef.current;
        if (mode === 'offline') {
            return offlineGameStatusRef.current;
        }

        if (!room || !room.state || !room.sessionId) {
            return 'loading';
        }
        
        const me = room.state.players.get(room.sessionId);
        if (!me) {
            return 'loading';
        }

        if (me.health <= 0) {
            return 'gameover';
        } else if (me.isReady) {
            return 'playing';
        } else {
            return 'ready';
        }
    };
    const [gameStatus, setGameStatus] = useState<OnlineGameStatus | OfflineGameStatus>(getGameStatus());


    const handleLeaveGame = useCallback(() => {
      roomRef.current?.leave();
      router.push('/');
    }, [router]);

    const startNewWave = useCallback(async () => {
        const currentWave = wave + 1;
        setWave(currentWave);
        
        playerPerformanceRef.current.waveStartTime = performance.now();
        
        const perf = playerPerformanceRef.current;
        const accuracy = perf.shotsFired > 0 ? (perf.shotsHit / perf.shotsFired) * 100 : 50; // Default to 50% accuracy if no shots fired
        const playTimeFactor = perf.totalPlayTime > 0 ? 1 / (perf.totalPlayTime / 60) : 1; // Normalize over minutes
        const skillRating = Math.max(0, Math.min(100, accuracy - (perf.damageTaken / 20) * playTimeFactor));
        
        const behavior = await generateOpponentBehavior({ waveNumber: currentWave, playerSkillLevel: skillRating });
        
        const enemyCount = 1 + Math.floor(currentWave / 2);
        
        for (let i = 0; i < enemyCount; i++) {
            const enemyId = `enemy_${currentWave}_${i}`;
            const spawnAngle = Math.random() * Math.PI * 2;
            const spawnDist = 800 + Math.random() * 200;
            const spawnX = Math.cos(spawnAngle) * spawnDist;
            const spawnZ = Math.sin(spawnAngle) * spawnDist;
            const spawnY = Math.random() * 100 + 80;

            const enemyMesh = createVoxelPlane(0xff0000);
            enemyMesh.position.set(spawnX, spawnY, spawnZ);
            sceneRef.current?.add(enemyMesh);
            
            const enemy: OfflineEnemy = {
                id: enemyId,
                mesh: enemyMesh,
                position: new THREE.Vector3(spawnX, spawnY, spawnZ),
                quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1), offlinePlayerRef.current.position.clone().sub(new THREE.Vector3(spawnX, spawnY, spawnZ)).normalize()),
                health: 100,
                behavior,
                gunCooldown: Math.random() * 2 + 1,
            };
            offlineEnemiesRef.current.push(enemy);
        }

    }, [wave]);

    const resetOfflineGame = useCallback(() => {
        const playerState = offlinePlayerRef.current;
        playerState.position.copy(OFFLINE_SPAWN_POS);
        playerState.quaternion.set(0, 0, 0, 1);
        playerState.health = 100;
        playerState.gunCooldown = 0;
        playerState.gunOverheat = 0;
        
        setPlayerHealth(100);
        setGunOverheat(0);
        setScore(0);
        setWave(0);

        if (sceneRef.current) {
            localOfflineBulletsRef.current.forEach(b => sceneRef.current!.remove(b.mesh));
            offlineEnemyBulletsRef.current.forEach(b => sceneRef.current!.remove(b.mesh));
            offlineEnemiesRef.current.forEach(e => sceneRef.current!.remove(e.mesh));
        }
        localOfflineBulletsRef.current = [];
        offlineEnemyBulletsRef.current = [];
        offlineEnemiesRef.current = [];
        playerPerformanceRef.current = { shotsFired: 0, shotsHit: 0, damageTaken: 0, waveStartTime: 0, totalPlayTime: 0 };
        
        altitudeWarningTimerRef.current = 5;
        boundaryWarningTimerRef.current = 7;
        offlineGameStatusRef.current = 'playing';
        setGameStatus('playing');
        startNewWave();
    }, [startNewWave]);

    const handleReady = () => {
        if (mode === 'online') {
            roomRef.current?.send("player_ready");
        } else {
            resetOfflineGame();
        }
    };

    const createScaledBox = (mesh: THREE.Mesh, scale: number): THREE.Box3 => {
        mesh.updateMatrixWorld();
        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        size.multiplyScalar(scale);
        return new THREE.Box3().setFromCenterAndSize(center, size);
    };
    
    useEffect(() => {
        if (typeof window === 'undefined' || !mountRef.current) return;

        let isMounted = true;
        let animationFrameId: number;
        let client: Colyseus.Client;
        let inputInterval: NodeJS.Timeout;

        const scene = new THREE.Scene();
        sceneRef.current = scene;
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });

        const localPlanes: Record<string, THREE.Group> = {};
        const localBullets: Record<string, THREE.Mesh> = {};
        const collidableObjects: THREE.Box3[] = [];

        let seed = WORLD_SEED;
        const seededRandom = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };


        const init = async () => {
            if (!isMounted || !mountRef.current) return;

            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
            mountRef.current.appendChild(renderer.domElement);
            
            scene.background = new THREE.Color(0x87CEEB);
            scene.fog = new THREE.Fog(0x87CEEB, 1000, 2500);

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(5, 10, 7.5);
            scene.add(directionalLight);

            const groundGeo = new THREE.PlaneGeometry(2000, 2000);
            const groundMat = new THREE.MeshLambertMaterial({ color: 0x4A6B3A, flatShading: true });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = GROUND_Y;
            scene.add(ground);
            collidableObjects.push(new THREE.Box3().setFromObject(ground));
            
            seed = WORLD_SEED; 
            for (let i = 0; i < 20; i++) {
                const mountainPosX = (seededRandom() - 0.5) * 1800;
                const mountainPosZ = (seededRandom() - 0.5) * 1800;
                const layers = Math.floor(seededRandom() * 5) + 3;
                let baseRadius = seededRandom() * 50 + 40;
                let currentY = GROUND_Y;

                for (let j = 0; j < layers; j++) {
                    const height = seededRandom() * 30 + 20;
                    const radius = baseRadius * ((layers - j) / layers);
                    const isSnowCapped = j >= layers - 2 && currentY + height > 100;
                    const matColor = isSnowCapped ? 0xffffff : 0x8B4513;

                    const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 8);
                    const mat = new THREE.MeshLambertMaterial({ color: matColor, flatShading: true });
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.position.set(mountainPosX, currentY + height / 2, mountainPosZ);
                    scene.add(mesh);
                    collidableObjects.push(createScaledBox(mesh, 0.8));
                    currentY += height * 0.8;
                }
            }

            const matrix = new THREE.Matrix4();
            
            // Instanced Trees
            const trunkGeo = new THREE.CylinderGeometry(1, 1, 10, 6);
            const leavesGeo = new THREE.ConeGeometry(5, 15, 8);
            const treeMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, flatShading: true });
            const leavesMat = new THREE.MeshLambertMaterial({ color: 0x006400, flatShading: true });
            const instancedTrunkMesh = new THREE.InstancedMesh(trunkGeo, treeMat, 50);
            const instancedLeavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, 50);
            scene.add(instancedTrunkMesh, instancedLeavesMesh);

            for (let i = 0; i < 50; i++) {
                const treeX = (seededRandom() - 0.5) * 1800;
                const treeZ = (seededRandom() - 0.5) * 1800;
                
                matrix.setPosition(treeX, GROUND_Y + 5, treeZ);
                instancedTrunkMesh.setMatrixAt(i, matrix);
                const trunkBox = new THREE.Box3().setFromBufferAttribute(trunkGeo.attributes.position as THREE.BufferAttribute);
                trunkBox.applyMatrix4(matrix);
                collidableObjects.push(trunkBox);

                matrix.setPosition(treeX, GROUND_Y + 15, treeZ);
                instancedLeavesMesh.setMatrixAt(i, matrix);
                const leavesBox = new THREE.Box3().setFromBufferAttribute(leavesGeo.attributes.position as THREE.BufferAttribute);
                leavesBox.applyMatrix4(matrix);
                collidableObjects.push(leavesBox);
            }
            instancedTrunkMesh.instanceMatrix.needsUpdate = true;
            instancedLeavesMesh.instanceMatrix.needsUpdate = true;


            for (let i = 0; i < 15; i++) {
                const lakeGeo = new THREE.CylinderGeometry(seededRandom() * 40 + 30, seededRandom() * 40 + 30, 0.5, 32);
                const lakeMat = new THREE.MeshBasicMaterial({ color: 0x4682B4 });
                const lake = new THREE.Mesh(lakeGeo, lakeMat);
                lake.position.set((seededRandom() - 0.5) * 1800, GROUND_Y + 0.26, (seededRandom() - 0.5) * 1800);
                scene.add(lake);
            }
            for (let i = 0; i < 10; i++) {
                const tank = new THREE.Group();
                const mat = new THREE.MeshLambertMaterial({ color: 0x556B2F, flatShading: true });
                const body = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 5), mat);
                tank.add(body);
                const turret = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), mat);
                turret.position.y = 2.5;
                tank.add(turret);
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5, 8), mat);
                barrel.position.set(0, 2.5, -4.5);
                barrel.rotation.x = Math.PI / 2;
                tank.add(barrel);
                tank.position.set((seededRandom() - 0.5) * 1800, GROUND_Y + 1.5, (seededRandom() - 0.5) * 1800);
                scene.add(tank);
            }
            
            // Instanced Clouds
            const CLOUD_COUNT = 50;
            const MAX_PUFFS_PER_CLOUD = 8;
            const puffGeo = new THREE.BoxGeometry(1, 1, 1);
            const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.8, transparent: true });
            const instancedCloudMesh = new THREE.InstancedMesh(puffGeo, puffMat, CLOUD_COUNT * MAX_PUFFS_PER_CLOUD);
            scene.add(instancedCloudMesh);
            
            let instanceIndex = 0;
            for (let i = 0; i < CLOUD_COUNT; i++) {
                const cloudX = (seededRandom() - 0.5) * 1800;
                const cloudY = seededRandom() * 100 + 80;
                const cloudZ = (seededRandom() - 0.5) * 1800;
                const puffCount = Math.floor(seededRandom() * 5) + 3;
                
                for (let j = 0; j < puffCount; j++) {
                    const size = seededRandom() * 40 + 20;
                    const puffX = cloudX + (seededRandom() - 0.5) * 60;
                    const puffY = cloudY + (seededRandom() - 0.5) * 20;
                    const puffZ = cloudZ + (seededRandom() - 0.5) * 60;

                    matrix.makeScale(size, size, size);
                    matrix.setPosition(puffX, puffY, puffZ);
                    if (instanceIndex < CLOUD_COUNT * MAX_PUFFS_PER_CLOUD) {
                        instancedCloudMesh.setMatrixAt(instanceIndex++, matrix);
                    }
                }
            }
            instancedCloudMesh.instanceMatrix.needsUpdate = true;


            if (mode === 'offline') {
                const planeMesh = createVoxelPlane(0x0077ff);
                planeMesh.position.copy(offlinePlayerRef.current.position);
                localPlanes['offline_player'] = planeMesh;
                scene.add(planeMesh);
            }

            if (mode === 'online') {
                if (isConnectingRef.current) return;
                isConnectingRef.current = true;
                try {
                    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
                    const endpoint = `${protocol}://${window.location.host}`;
                    client = new Colyseus.Client(endpoint);
                    const room = await client.joinOrCreate<VoxelAcesState>("voxel_aces_room", { playerName: playerNameProp, controlStyle });
                    roomRef.current = room;
                    isConnectingRef.current = false;
                    
                    room.onStateChange.once(() => {
                        // This ensures we have the initial state before proceeding
                        setGameStatus(getGameStatus());
                    });
                    
                    room.onStateChange(() => {
                        if (!isMounted) return;
                        setGameStatus(getGameStatus());
                    });

                    room.onLeave(() => { 
                        if (isMounted) { 
                            setGameStatus('loading');
                            router.push('/online'); 
                        } 
                    });
                    
                    room.state.players.onAdd((player, sessionId) => {
                        const isMe = sessionId === room?.sessionId;
                        const color = isMe ? 0x0077ff : (player.isAI ? 0xff0000 : 0xffaa00);
                        const planeMesh = createVoxelPlane(color);
                        planeMesh.position.set(player.x, player.y, player.z);
                        planeMesh.quaternion.set(player.qx, player.qy, player.qz, player.qw);
                        localPlanes[sessionId] = planeMesh;
                        scene.add(planeMesh);
                        if(isMe) {
                            setPlayerHealth(player.health);
                            player.listen("health", (currentValue) => setPlayerHealth(currentValue));
                            player.listen("kills", (currentValue) => setScore(currentValue));
                            player.listen("gunOverheat", (currentValue) => setGunOverheat(currentValue));
                        }
                    });

                    room.state.players.onRemove((_, sessionId) => { if (localPlanes[sessionId]) { scene.remove(localPlanes[sessionId]); delete localPlanes[sessionId]; } });
                    room.state.bullets.onAdd((bullet, bulletId) => {
                        const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                        const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                        bulletMesh.position.set(bullet.x, bullet.y, bullet.z);
                        localBullets[bulletId] = bulletMesh;
                        scene.add(bulletMesh);
                    });
                    room.state.bullets.onRemove((_, bulletId) => { if(localBullets[bulletId]) { scene.remove(localBullets[bulletId]); delete localBullets[bulletId]; } });
                    
                    inputInterval = setInterval(() => {
                        const currentRoom = roomRef.current;
                        if (currentRoom?.state && currentRoom?.sessionId) {
                             const me = currentRoom.state.players.get(currentRoom.sessionId);
                             if (me?.isReady) {
                                const playerInput = {
                                    w: !!keysPressed.current['w'], s: !!keysPressed.current['s'], a: !!keysPressed.current['a'], d: !!keysPressed.current['d'],
                                    shift: !!keysPressed.current['shift'], space: !!keysPressed.current[' '], mouse0: !!keysPressed.current['mouse0'],
                                    joystick: (onScreenControls && isMobile) ? joystickInput.current : null
                                };
                                currentRoom.send("input", playerInput);
                             }
                        }
                    }, 1000 / 20);
                } catch (e) { console.error("JOIN ERROR", e); isConnectingRef.current = false; router.push('/online'); }
            }
            
            const handleKeyDown = (e: KeyboardEvent) => { keysPressed.current[e.key.toLowerCase()] = true; };
            const handleKeyUp = (e: KeyboardEvent) => { keysPressed.current[e.key.toLowerCase()] = false; };
            const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) keysPressed.current['mouse0'] = true; };
            const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) keysPressed.current['mouse0'] = false; };
            const handleResize = () => { if (!mountRef.current) return; camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight); };
            window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp); window.addEventListener('mousedown', handleMouseDown); window.addEventListener('mouseup', handleMouseUp); window.addEventListener('resize', handleResize);
            
            let lastTime = 0;
            const gameLoop = (time: number) => {
                if (!isMounted) return;
                animationFrameId = requestAnimationFrame(gameLoop);
                const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
                lastTime = time;

                const currentStatus = getGameStatus();
                if(gameStatus !== currentStatus) {
                    setGameStatus(currentStatus);
                }
                
                let myPlane: THREE.Group | null = null;
                const currentRoom = roomRef.current;

                if (mode === 'offline') {
                    if (offlineGameStatusRef.current !== 'playing') {
                        renderer.render(scene, camera);
                        return;
                    }
                    playerPerformanceRef.current.totalPlayTime += delta;

                    myPlane = localPlanes['offline_player'];
                    const playerState = offlinePlayerRef.current;
                    
                    let pitch = 0; let roll = 0;
                    if (onScreenControls && isMobile) {
                        pitch = -joystickInput.current.y;
                        roll = -joystickInput.current.x;
                    } else {
                        if (keysPressed.current['w']) pitch = 1;
                        if (keysPressed.current['s']) pitch = -1;
                        if (keysPressed.current['a']) roll = 1;
                        if (keysPressed.current['d']) roll = -1;
                    }
                    if (controlStyle === 'realistic' && !isMobile) { pitch *= -1; }

                    if (pitch !== 0) playerState.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PITCH_SPEED * pitch * delta));
                    if (roll !== 0) playerState.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_SPEED * roll * delta));
                                        
                    const speed = keysPressed.current['shift'] ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;
                    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerState.quaternion);
                    playerState.position.add(forward.multiplyScalar(speed * delta));

                    if (myPlane) { myPlane.position.copy(playerState.position); myPlane.quaternion.copy(playerState.quaternion); }
                    
                    playerState.gunCooldown = Math.max(0, playerState.gunCooldown - delta);
                    playerState.gunOverheat = Math.max(0, playerState.gunOverheat - 15 * delta);
                    setGunOverheat(playerState.gunOverheat);

                    if ((keysPressed.current[' '] || keysPressed.current['mouse0']) && playerState.gunCooldown <= 0 && playerState.gunOverheat < 100) {
                        playerPerformanceRef.current.shotsFired++;
                        playerState.gunCooldown = 0.1;
                        playerState.gunOverheat += 5;
                        const bulletId = Math.random().toString(36).substring(2, 15);
                        const bulletQuaternion = playerState.quaternion;
                        const bulletVelocity = new THREE.Vector3(0, 0, -BULLET_SPEED).applyQuaternion(bulletQuaternion);
                        if (myPlane) {
                            const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                            const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                            const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                            bulletMesh.position.copy(myPlane.position);
                            scene.add(bulletMesh);
                            const bullet = { id: bulletId, position: myPlane.position.clone(), velocity: bulletVelocity, spawnTime: time, mesh: bulletMesh };
                            localOfflineBulletsRef.current.push(bullet);
                        }
                    }

                    // UPDATE OFFLINE AI
                    offlineEnemiesRef.current.forEach(enemy => {
                        // Simplified AI: fly towards player
                        const directionToPlayer = playerState.position.clone().sub(enemy.position).normalize();
                        const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.quaternion);
                        const rotation = new THREE.Quaternion().setFromUnitVectors(forwardVector, directionToPlayer);
                        enemy.quaternion.slerp(rotation, 0.02);
                        enemy.position.add(forwardVector.multiplyScalar(BASE_SPEED * 0.8 * delta)); // AI is slightly slower
                        enemy.mesh.position.copy(enemy.position);
                        enemy.mesh.quaternion.copy(enemy.quaternion);

                        enemy.gunCooldown = Math.max(0, enemy.gunCooldown - delta);
                        const angleToPlayer = forwardVector.angleTo(directionToPlayer);
                        if(enemy.gunCooldown <= 0 && angleToPlayer < 0.2) { // Fire if aimed at player
                             enemy.gunCooldown = 2.0; // Slower fire rate for AI
                             const bulletId = Math.random().toString(36).substring(2, 15);
                             const bulletVelocity = new THREE.Vector3(0, 0, -BULLET_SPEED).applyQuaternion(enemy.quaternion);
                             const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                             const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
                             const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                             bulletMesh.position.copy(enemy.position);
                             scene.add(bulletMesh);
                             offlineEnemyBulletsRef.current.push({ id: bulletId, position: enemy.position.clone(), velocity: bulletVelocity, spawnTime: time, mesh: bulletMesh });
                        }
                    });


                    // UPDATE BULLETS (PLAYER)
                    localOfflineBulletsRef.current = localOfflineBulletsRef.current.filter(bullet => {
                        bullet.position.add(bullet.velocity.clone().multiplyScalar(delta));
                        bullet.mesh.position.copy(bullet.position);
                        if (time - bullet.spawnTime > BULLET_LIFESPAN_MS) {
                            scene.remove(bullet.mesh);
                            return false;
                        }
                        // Collision check
                        for (const enemy of offlineEnemiesRef.current) {
                            if (enemy.mesh.position.distanceTo(bullet.position) < 5) {
                                enemy.health -= 25;
                                playerPerformanceRef.current.shotsHit++;
                                scene.remove(bullet.mesh);
                                if(enemy.health <= 0) {
                                    setScore(s => s + 100);
                                    scene.remove(enemy.mesh);
                                    offlineEnemiesRef.current = offlineEnemiesRef.current.filter(e => e.id !== enemy.id);
                                    if(offlineEnemiesRef.current.length === 0) {
                                        playerPerformanceRef.current.totalPlayTime += (performance.now() - playerPerformanceRef.current.waveStartTime) / 1000;
                                        startNewWave();
                                    }
                                }
                                return false; // remove bullet
                            }
                        }
                        return true;
                    });
                    
                    // UPDATE BULLETS (AI)
                     offlineEnemyBulletsRef.current = offlineEnemyBulletsRef.current.filter(bullet => {
                        bullet.position.add(bullet.velocity.clone().multiplyScalar(delta));
                        bullet.mesh.position.copy(bullet.position);
                        if (time - bullet.spawnTime > BULLET_LIFESPAN_MS) {
                            scene.remove(bullet.mesh);
                            return false;
                        }
                         if (myPlane && myPlane.position.distanceTo(bullet.position) < 5) {
                             playerState.health -= 10;
                             playerPerformanceRef.current.damageTaken += 10;
                             setPlayerHealth(playerState.health);
                             scene.remove(bullet.mesh);
                             if(playerState.health <= 0) {
                                 playerState.health = 0;
                                 offlineGameStatusRef.current = 'gameover';
                                 setGameStatus('gameover');
                             }
                             return false; // remove bullet
                         }
                        return true;
                    });

                    if (myPlane) {
                        let hasCrashed = false;
                        const terrainHitboxMesh = new THREE.Mesh(TERRAIN_COLLISION_GEOMETRY);
                        terrainHitboxMesh.position.copy(myPlane.position);
                        terrainHitboxMesh.quaternion.copy(myPlane.quaternion);
                        const playerHitbox = createScaledBox(terrainHitboxMesh, 0.8);
                        
                        for (const obstacle of collidableObjects) { if (playerHitbox.intersectsBox(obstacle)) { hasCrashed = true; break; } }
                        if (boundaryWarningTimerRef.current <= 0 || altitudeWarningTimerRef.current <= 0) { hasCrashed = true; }
                        if (hasCrashed && playerState.health > 0) { 
                            playerState.health = 0; 
                            setPlayerHealth(0);
                            offlineGameStatusRef.current = 'gameover';
                            setGameStatus('gameover');
                        }
                    }
                }
                
                // This block runs for BOTH online and offline mode
                const localPlayerPos = (mode === 'online' && currentRoom?.state && currentRoom?.sessionId && localPlanes[currentRoom.sessionId]) 
                    ? localPlanes[currentRoom.sessionId].position 
                    : (myPlane ? myPlane.position : null);

                if (localPlayerPos) {
                    const currentAltitude = localPlayerPos.y - GROUND_Y;
                    setAltitude(currentAltitude);
                    
                    let altWarn = currentAltitude > MAX_ALTITUDE;
                    if (altWarn) { altitudeWarningTimerRef.current = Math.max(0, altitudeWarningTimerRef.current - delta); setWhiteoutOpacity(Math.max(0, 1 - (altitudeWarningTimerRef.current / 5))); } 
                    else { altitudeWarningTimerRef.current = 5; setWhiteoutOpacity(0); }
                    setShowAltitudeWarning(altWarn);

                    let boundaryWarn = Math.abs(localPlayerPos.x) > BOUNDARY || Math.abs(localPlayerPos.z) > BOUNDARY;
                    if (boundaryWarn) { boundaryWarningTimerRef.current = Math.max(0, boundaryWarningTimerRef.current - delta); } 
                    else { boundaryWarningTimerRef.current = 7; }
                    setShowBoundaryWarning(boundaryWarn);
                }

                if (currentStatus === 'playing') {
                     if (localPlayerPos && myPlane) {
                         const cameraOffset = new THREE.Vector3(0, 8, 15);
                         const idealOffset = cameraOffset.clone().applyQuaternion(myPlane.quaternion);
                         const idealPosition = myPlane.position.clone().add(idealOffset);
                         camera.position.lerp(idealPosition, 0.1);
                         camera.lookAt(myPlane.position);
                     } else if (mode === 'online' && currentRoom?.state && currentRoom?.sessionId) {
                        const myOnlinePlane = localPlanes[currentRoom.sessionId];
                        if (myOnlinePlane) {
                            const cameraOffset = new THREE.Vector3(0, 8, 15);
                            const idealOffset = cameraOffset.clone().applyQuaternion(myOnlinePlane.quaternion);
                            const idealPosition = myOnlinePlane.position.clone().add(idealOffset);
                            camera.position.lerp(idealPosition, 0.1);
                            camera.lookAt(myOnlinePlane.position);
                        }
                     }
                }
                
                // Interpolation for online mode
                if (mode === 'online' && currentRoom?.state) {
                    currentRoom.state.players.forEach((player, sessionId) => {
                        const planeMesh = localPlanes[sessionId];
                        if(planeMesh) {
                            if (!player.isReady) {
                                planeMesh.visible = false;
                                return;
                            }
                            planeMesh.visible = true;
                            const newPos = new THREE.Vector3(player.x, player.y, player.z);
                            const newQuat = new THREE.Quaternion(player.qx, player.qy, player.qz, player.qw);
                            
                            // Check the distance between the client's current position and the server's new position.
                            const distance = planeMesh.position.distanceTo(newPos);

                            // If the distance is very large, it's a respawn. Teleport the plane instantly.
                            // Otherwise, interpolate for smooth movement.
                            if (distance > 1000) { 
                                planeMesh.position.copy(newPos);
                                planeMesh.quaternion.copy(newQuat);
                            } else {
                                planeMesh.position.lerp(newPos, INTERPOLATION_FACTOR);
                                planeMesh.quaternion.slerp(newQuat, INTERPOLATION_FACTOR);
                            }
                        }
                    });
                    currentRoom.state.bullets.forEach((bullet, bulletId) => {
                        const bulletMesh = localBullets[bulletId];
                        if (bulletMesh) { bulletMesh.position.set(bullet.x, bullet.y, bullet.z); }
                    });
                }

                renderer.render(scene, camera);
            };
            gameLoop(performance.now());
        }

        init();

        return () => {
            isMounted = false;
            cancelAnimationFrame(animationFrameId);
            if (inputInterval) clearInterval(inputInterval);
            roomRef.current?.leave();
            roomRef.current = null;
            isConnectingRef.current = false;
            window.removeEventListener('keydown', () => {}); window.removeEventListener('keyup', () => {}); window.removeEventListener('mousedown', () => {}); window.removeEventListener('mouseup', () => {}); window.removeEventListener('resize', () => {});
            Object.values(localPlanes).forEach(plane => scene.remove(plane)); Object.values(localBullets).forEach(bullet => scene.remove(bullet)); localOfflineBulletsRef.current.forEach(b => scene.remove(b.mesh));
            offlineEnemiesRef.current.forEach(e => scene.remove(e.mesh)); offlineEnemyBulletsRef.current.forEach(b => scene.remove(b.mesh));
            if(mountRef.current && renderer.domElement && mountRef.current.contains(renderer.domElement)) { mountRef.current.removeChild(renderer.domElement); }
            renderer.dispose(); scene.clear();
        };
    // The main setup effect should only run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [offlineUIState, setOfflineUIState] = useState<'menu' | 'playing' | 'gameover'>('menu');
    useEffect(() => {
        if (mode === 'offline') {
            setOfflineUIState(offlineGameStatusRef.current);
        }
    }, [gameStatus, mode]);


    const renderContent = () => {
        const currentStatus = getGameStatus();

        if (currentStatus === 'loading') {
            return (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-20">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    <p className="text-xl mt-4 font-headline">Connecting to Arena...</p>
                </div>
            );
        }

        if (mode === 'offline') {
             if (currentStatus === 'menu' || currentStatus === 'gameover') {
                return (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
                            <CardHeader>
                                <CardTitle className="text-5xl font-bold font-headline text-primary">
                                    {currentStatus === 'gameover' ? 'Shot Down!' : 'Ready for Takeoff?'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-8 pt-0">
                                {currentStatus === 'gameover' 
                                    ? <p className="text-muted-foreground mb-6">You were defeated on wave {wave} with a score of {score}. Better luck next time!</p>
                                    : <p className="text-muted-foreground mb-6">Use WASD to steer, Shift for boost, and Left Click or Space to fire. Good luck!</p>
                                }
                                <Button size="lg" className="w-full text-lg py-6" onClick={handleReady}>
                                    {currentStatus === 'gameover' ? 'Fly Again' : 'Start Flight'}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                );
            }
        }

        if (mode === 'online') {
            if (currentStatus === 'ready') {
                return (
                     <div className="absolute inset-0 flex items-center justify-center z-10">
                        <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
                            <CardHeader><CardTitle className="text-5xl font-bold font-headline text-primary">Ready to Fly?</CardTitle></CardHeader>
                            <CardContent className="p-8 pt-0">
                                <p className="text-muted-foreground mb-6">The arena is waiting. Join the battle when you're ready.</p>
                                <Button size="lg" className="w-full text-lg py-6" onClick={handleReady}>Join the Battle</Button>
                            </CardContent>
                        </Card>
                    </div>
                );
            }
            if (currentStatus === 'gameover') {
                 return (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                         <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-destructive/50 shadow-xl text-center">
                            <CardHeader><CardTitle className="text-5xl font-bold font-headline text-destructive">Shot Down!</CardTitle></CardHeader>
                            <CardContent className="p-8 pt-0">
                                 <p className="text-foreground mb-6">You were shot down with a final score of <span className="font-bold text-accent">{score}</span> kills.</p>
                                <Button size="lg" className="w-full text-lg py-6" onClick={handleReady}>Play Again</Button>
                                <Button size="lg" variant="secondary" className="w-full text-lg py-6 mt-2" onClick={handleLeaveGame}>Back to Menu</Button>
                            </CardContent>
                        </Card>
                    </div>
                );
            }
        }
        
        return null;
    }


    return (
        <div className="relative w-screen h-screen bg-background overflow-hidden touch-none" onContextMenu={(e) => e.preventDefault()}>
            <div ref={mountRef} className="absolute top-0 left-0 w-full h-full" />
            
            {onScreenControls && isMobile && getGameStatus() === 'playing' && <OnScreenControls joystickInput={joystickInput} keysPressed={keysPressed} />}

            <div className="absolute inset-0 bg-white z-10 pointer-events-none" style={{ opacity: whiteoutOpacity, transition: 'opacity 0.5s' }} />
            
            {renderContent()}

            {showAltitudeWarning && getGameStatus() === 'playing' && (
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-20 text-center">
                    <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: ALTITUDE CRITICAL</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Descend below {MAX_ALTITUDE}m immediately!</p>
                            <p className="text-5xl font-mono font-bold mt-2">{altitudeWarningTimerRef.current.toFixed(1)}</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showBoundaryWarning && getGameStatus() === 'playing' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 text-center">
                     <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: LEAVING BATTLEFIELD</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Return to the combat zone!</p>
                            <p className="text-5xl font-mono font-bold mt-2">{boundaryWarningTimerRef.current.toFixed(1)}</p>
                        </CardContent>
                    </Card>
                </div>
            )}
            
            {getGameStatus() === 'playing' ? (
                 <HUD score={score} wave={wave} health={playerHealth} overheat={gunOverheat} altitude={altitude} mode={mode} players={roomRef.current?.state.players} leaderboard={roomRef.current?.state.leaderboard} onLeaveGame={handleLeaveGame} />
            ) : null}

        </div>
    );
}
