
'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Home, Share2 } from 'lucide-react';
import { generateOpponentBehavior, type OpponentBehaviorOutput } from '@/ai/flows/ai-opponent-behavior';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast";
import { db } from '@/lib/firebase';
import { doc, runTransaction, deleteDoc, collection, onSnapshot, updateDoc, writeBatch, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';


type GameState = 'loading' | 'menu' | 'playing' | 'gameover';
type GameMode = 'offline' | 'online';

interface GameProps {
  mode: GameMode;
  serverId?: string;
  playerName?: string;
}

type Bullet = {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    ownerId: string;
};

type Enemy = {
    mesh: THREE.Group;
    health: number;
    behavior: OpponentBehaviorOutput;
    gunCooldown: number;
    state: 'attacking' | 'flyby';
    stateTimer: number;
};

type OtherPlayer = {
    mesh: THREE.Group;
    name: string;
    health: number;
};

export default function Game({ mode, serverId: serverIdProp, playerName: playerNameProp }: GameProps) {
    const mountRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const { toast } = useToast();

    // Player ID is now internal state, set after joining a server.
    const [playerId, setPlayerId] = useState<string | null>(null);

    const [gameState, setGameState] = useState<GameState>('loading');
    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(1);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [gunOverheat, setGunOverheat] = useState(0);
    const [altitude, setAltitude] = useState(0);
    const [showAltitudeWarning, setShowAltitudeWarning] = useState(false);
    const [altitudeWarningTimer, setAltitudeWarningTimer] = useState(5);
    const [showBoundaryWarning, setShowBoundaryWarning] = useState(false);
    const [boundaryWarningTimer, setBoundaryWarningTimer] = useState(7);
    const [whiteoutOpacity, setWhiteoutOpacity] = useState(0);
    
    const gameStateRef = useRef(gameState);
    const waveRef = useRef(wave);
    const altitudeWarningTimerRef = useRef(5);
    const boundaryWarningTimerRef = useRef(7);
    const playerBulletsRef = useRef<Bullet[]>([]);
    const enemyBulletsRef = useRef<Enemy[]>([]);
    const enemiesRef = useRef<Enemy[]>([]);
    
    const otherPlayersRef = useRef<Record<string, OtherPlayer>>({});
    const lastUpdateTimeRef = useRef(0);

    const sceneRef = useRef<THREE.Scene | null>(null);
    const playerRef = useRef<THREE.Group | null>(null);

    useEffect(() => {
      gameStateRef.current = gameState;
    }, [gameState]);

    useEffect(() => {
        waveRef.current = wave;
    }, [wave]);

    // This effect handles joining the game and cleaning up on unmount for ONLINE mode.
    useEffect(() => {
        if (mode !== 'online' || !serverIdProp || !playerNameProp) {
            if (mode === 'offline') setGameState('menu');
            return;
        }

        let isMounted = true;
        let createdPlayerId: string | null = null;
        const serverRef = doc(db, 'servers', serverIdProp);

        const joinGame = async () => {
            try {
                // 1. Create the player document
                const playerDocRef = await addDoc(collection(db, `servers/${serverIdProp}/players`), {
                    name: playerNameProp,
                    joinedAt: serverTimestamp(),
                    kills: 0,
                    health: 100,
                    position: { x: (Math.random() - 0.5) * 500, y: 50, z: (Math.random() - 0.5) * 500 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                });
                
                createdPlayerId = playerDocRef.id;

                // 2. Update server player count
                await runTransaction(db, async (transaction) => {
                    const freshServerDoc = await transaction.get(serverRef);
                    if (!freshServerDoc.exists()) throw "Server does not exist!";
                    const newPlayerCount = (freshServerDoc.data().players || 0) + 1;
                    transaction.update(serverRef, { players: newPlayerCount });
                });

                if (isMounted) {
                    setPlayerId(createdPlayerId);
                    setGameState('playing');
                }

            } catch (error) {
                console.error("Failed to join game:", error);
                toast({ title: "Error", description: "Could not join the game server.", variant: "destructive" });
                router.push('/online');
            }
        };

        joinGame();

        // Cleanup function: runs when the component unmounts
        return () => {
            isMounted = false;
            if (createdPlayerId) {
                const playerDocRef = doc(db, 'servers', serverIdProp, 'players', createdPlayerId);
                runTransaction(db, async (transaction) => {
                    const serverDoc = await transaction.get(serverRef);
                    if (serverDoc.exists()) {
                        const newPlayerCount = Math.max(0, (serverDoc.data().players || 1) - 1);
                        transaction.update(serverRef, { players: newPlayerCount });
                    }
                    transaction.delete(playerDocRef);
                }).catch(e => console.error("Error during cleanup:", e));
            }
        };

    }, [mode, serverIdProp, playerNameProp, router, toast]);

    const startGame = useCallback(async () => {
        if (mode === 'online' && serverIdProp && playerId) {
            const playerDocRef = doc(db, 'servers', serverIdProp, 'players', playerId);
            const randomPos = { x: (Math.random() - 0.5) * 800, y: 50, z: (Math.random() - 0.5) * 800 };
            try {
                // Use setDoc with merge to be safer, in case the doc was removed.
                await setDoc(playerDocRef, {
                    health: 100,
                    kills: 0,
                    position: randomPos,
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                }, { merge: true });

                if (playerRef.current) {
                    playerRef.current.position.set(randomPos.x, randomPos.y, randomPos.z);
                    playerRef.current.quaternion.set(0,0,0,1);
                }
            } catch (error) {
                 console.error("Error restarting game:", error);
                 toast({ title: "Error", description: "Could not restart the game.", variant: "destructive" });
            }
        }
        setGameState('playing');
        resetGame();
    }, [mode, serverIdProp, playerId, toast]);


    const handleLeaveGame = useCallback(() => {
        // The useEffect cleanup now handles database changes.
        // We just need to navigate away.
        router.push('/');
    }, [router]);

    const copyInviteLink = () => {
        if (serverIdProp) {
            const inviteLink = `${window.location.origin}/online`;
            navigator.clipboard.writeText(inviteLink);
            toast({
                title: "Copied to clipboard!",
                description: "Invite link copied. Friends can use it to join the game.",
            });
        }
    };

    const resetGame = () => {
            if (!playerRef.current || !sceneRef.current) return;
            playerRef.current.position.set(0, 50, 0);
            playerRef.current.rotation.set(0, 0, 0);
            playerRef.current.quaternion.set(0, 0, 0, 1);
            
            playerBulletsRef.current.forEach(b => sceneRef.current?.remove(b.mesh));
            playerBulletsRef.current = [];
            
            if (mode === 'offline') {
                enemyBulletsRef.current.forEach(b => sceneRef.current?.remove(b.mesh));
                enemyBulletsRef.current = [];
                enemiesRef.current.forEach(e => sceneRef.current?.remove(e.mesh));
                enemiesRef.current = [];
                setScore(0);
                setWave(1);
                 startNewWave(1);
            }

            setPlayerHealth(100);
            setGunOverheat(0);
            setAltitude(playerRef.current.position.y - (-50));
            setShowAltitudeWarning(false);
            setAltitudeWarningTimer(5);
            altitudeWarningTimerRef.current = 5;
            setShowBoundaryWarning(false);
            setBoundaryWarningTimer(7);
            boundaryWarningTimerRef.current = 7;
            setWhiteoutOpacity(0);
        };


    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!mountRef.current) return;
        
        const mount = mountRef.current;
        let animationFrameId: number;

        const scene = new THREE.Scene();
        sceneRef.current = scene;
        scene.background = new THREE.Color(0x87CEEB); 
        scene.fog = new THREE.Fog(0x87CEEB, 1000, 2500);

        const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 4000);
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
        
        renderer.setPixelRatio(1);
        
        const handleResize = () => {
            if (!mount) return;
            const width = mount.clientWidth;
            const height = mount.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };
        
        mount.appendChild(renderer.domElement);
        handleResize();

        const createVoxelPlane = (color: THREE.Color) => {
            const plane = new THREE.Group();
            const bodyMat = new THREE.MeshLambertMaterial({ color, flatShading: true });
            
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 4), bodyMat);
            plane.add(body);

            const wings = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 1.5), bodyMat);
            wings.position.y = 0.2;
            plane.add(wings);
            
            const tail = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1), bodyMat);
            tail.position.set(0, 0.2, -2.5);
            plane.add(tail);
            
            const cockpitGeo = new THREE.BoxGeometry(0.8, 0.6, 1);
            const cockpitMat = new THREE.MeshLambertMaterial({ color: 0x000000, flatShading: true });
            const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
            cockpit.position.set(0, 0.8, -0.5);
            plane.add(cockpit);
            
            return plane;
        };
        
        const player = createVoxelPlane(new THREE.Color(0x0077ff));
        playerRef.current = player;
        scene.add(player);

        const cameraOffset = new THREE.Vector3(0, 8, 15);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        scene.add(directionalLight);

        const groundGeo = new THREE.PlaneGeometry(2000, 2000);
        const groundMat = new THREE.MeshLambertMaterial({ color: 0x4A6B3A, flatShading: true });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -50;
        scene.add(ground);

        for (let i = 0; i < 4; i++) {
            const lakeGeo = new THREE.PlaneGeometry(Math.random() * 150 + 50, Math.random() * 150 + 50);
            const lakeMat = new THREE.MeshLambertMaterial({ color: 0x3d85c6, flatShading: true });
            const lake = new THREE.Mesh(lakeGeo, lakeMat);
            lake.rotation.x = -Math.PI / 2;
            lake.position.set(
                (Math.random() - 0.5) * 1900,
                -49.9,
                (Math.random() - 0.5) * 1900
            );
            scene.add(lake);
        }

        const createTree = (x: number, z: number) => {
            const tree = new THREE.Group();
            const trunkGeo = new THREE.BoxGeometry(4, 15, 4);
            const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, flatShading: true });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 7.5;
            tree.add(trunk);
            const leavesGeo = new THREE.BoxGeometry(12, 12, 12);
            const leavesMat = new THREE.MeshLambertMaterial({ color: 0x228B22, flatShading: true });
            const leaves = new THREE.Mesh(leavesGeo, leavesMat);
            leaves.position.y = 20;
            tree.add(leaves);
            tree.position.set(x, -50, z);
            scene.add(tree);
        };
        
        const createBush = (x: number, z: number) => {
            const bushGeo = new THREE.BoxGeometry(7, 7, 7);
            const bushMat = new THREE.MeshLambertMaterial({ color: 0x556B2F, flatShading: true });
            const bush = new THREE.Mesh(bushGeo, bushMat);
            bush.position.set(x, -46.5, z);
            scene.add(bush);
        };

        for (let i = 0; i < 75; i++) {
            const x = (Math.random() - 0.5) * 1900;
            const z = (Math.random() - 0.5) * 1900;
            if (Math.random() > 0.4) {
                createTree(x, z);
            } else {
                createBush(x, z);
            }
        }
        
        const cloudLayer = new THREE.Group();
        for(let i = 0; i < 150; i++) {
            const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
            const cloud = new THREE.Mesh(new THREE.BoxGeometry(
                Math.random() * 80 + 40, 
                Math.random() * 30 + 15, 
                Math.random() * 80 + 40
            ), cloudMat);
            cloud.position.set(
                (Math.random() - 0.5) * 2000, 
                150 + (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 2000
            );
            cloudLayer.add(cloud);
        }
        scene.add(cloudLayer);


        const keysPressed: Record<string, boolean> = {};
        let gunCooldown = 0;
        
        let lastGameState = gameStateRef.current;
        
        const spawnEnemy = async () => {
            if (!sceneRef.current || !playerRef.current) return;
            try {
                const behavior = await generateOpponentBehavior({
                    waveNumber: waveRef.current,
                    playerSkillLevel: 'intermediate',
                });
                const enemyMesh = createVoxelPlane(new THREE.Color(0xff0000));
                const boundary = 1000;
                const spawnAngle = Math.random() * Math.PI * 2;
                const spawnDist = 600 + Math.random() * 200;
                let spawnX = playerRef.current.position.x + Math.sin(spawnAngle) * spawnDist;
                let spawnZ = playerRef.current.position.z + Math.cos(spawnAngle) * spawnDist;
                spawnX = THREE.MathUtils.clamp(spawnX, -boundary + 50, boundary - 50);
                spawnZ = THREE.MathUtils.clamp(spawnZ, -boundary + 50, boundary - 50);
                const spawnY = THREE.MathUtils.clamp(playerRef.current.position.y + (Math.random() - 0.5) * 100, 50, 150);
                enemyMesh.position.set(spawnX, spawnY, spawnZ);
                enemyMesh.lookAt(playerRef.current.position);
                sceneRef.current.add(enemyMesh);
                const newEnemy: Enemy = {
                    mesh: enemyMesh,
                    health: 100,
                    behavior,
                    gunCooldown: 2 + Math.random() * 2,
                    state: 'attacking',
                    stateTimer: 0,
                };
                enemiesRef.current.push(newEnemy);
            } catch (error) {
                console.error("Failed to spawn enemy:", error);
            }
        };

        const startNewWave = (waveNumber: number) => {
            setScore(s => s + (waveRef.current - 1) * 100);
            setTimeout(async () => {
                if(gameStateRef.current !== 'playing') return;
                for (let i = 0; i < waveNumber; i++) {
                    await spawnEnemy();
                }
            }, 2500);
        };
        
        let lastTime = 0;
        const gameLoop = (time: number) => {
            animationFrameId = requestAnimationFrame(gameLoop);
            const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
            lastTime = time;

            if (gameStateRef.current === 'playing' && lastGameState !== 'playing') {
                 if (mode === 'offline') resetGame();
            }
            lastGameState = gameStateRef.current;
            
            if (gameStateRef.current === 'playing' && playerRef.current) {
                const PITCH_SPEED = 1.2;
                const ROLL_SPEED = 1.8;
                const YAW_SPEED = 1.0;
                const BASE_SPEED = 30;
                const BOOST_MULTIPLIER = 2.0;

                if (keysPressed['w'] || keysPressed['W']) playerRef.current.rotateX(-PITCH_SPEED * delta);
                if (keysPressed['s'] || keysPressed['S']) playerRef.current.rotateX(PITCH_SPEED * delta);
                if (keysPressed['a'] || keysPressed['A']) {
                    playerRef.current.rotateZ(ROLL_SPEED * delta);
                    playerRef.current.rotateY(YAW_SPEED * delta);
                }
                if (keysPressed['d'] || keysPressed['D']) {
                    playerRef.current.rotateZ(-ROLL_SPEED * delta);
                    playerRef.current.rotateY(-YAW_SPEED * delta);
                }

                let currentSpeed = BASE_SPEED;
                if (keysPressed['shift']) currentSpeed *= BOOST_MULTIPLIER;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerRef.current.quaternion);
                playerRef.current.position.add(forward.multiplyScalar(currentSpeed * delta));
                
                if (mode === 'online' && playerId && serverIdProp && playerRef.current) {
                    const now = performance.now();
                    if(now - lastUpdateTimeRef.current > 100) {
                        lastUpdateTimeRef.current = now;
                        const pos = playerRef.current.position;
                        const quat = playerRef.current.quaternion;
                        // Use setDoc with merge to prevent "No document to update" error
                        setDoc(doc(db, 'servers', serverIdProp, 'players', playerId), {
                           position: { x: pos.x, y: pos.y, z: pos.z },
                           quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
                        }, { merge: true }).catch(console.error);
                    }
                }


                const groundLevel = ground.position.y;
                const currentAltitude = playerRef.current.position.y - groundLevel;
                setAltitude(currentAltitude);

                if (currentAltitude <= 0 && playerHealth > 0) {
                    setPlayerHealth(0); 
                    if (gameStateRef.current === 'playing') setGameState('gameover');
                }

                if (currentAltitude > 200) setWhiteoutOpacity(Math.min(0.95, ((currentAltitude - 200) / 20) * 0.95)); else setWhiteoutOpacity(0);
                
                if (currentAltitude > 220) {
                    setShowAltitudeWarning(true);
                    altitudeWarningTimerRef.current -= delta;
                    setAltitudeWarningTimer(Math.max(0, altitudeWarningTimerRef.current));
                    if (altitudeWarningTimerRef.current <= 0 && playerHealth > 0) {
                         setPlayerHealth(0);
                         if (gameStateRef.current === 'playing') setGameState('gameover');
                    }
                } else {
                    setShowAltitudeWarning(false);
                    altitudeWarningTimerRef.current = 5;
                    setAltitudeWarningTimer(5);
                }

                const boundary = 1000;
                if (Math.abs(playerRef.current.position.x) > boundary || Math.abs(playerRef.current.position.z) > boundary) {
                    setShowBoundaryWarning(true);
                    boundaryWarningTimerRef.current -= delta;
                    setBoundaryWarningTimer(Math.max(0, boundaryWarningTimerRef.current));
                    if (boundaryWarningTimerRef.current <= 0 && playerHealth > 0) {
                        setPlayerHealth(0);
                        if (gameStateRef.current === 'playing') setGameState('gameover');
                    }
                } else {
                    setShowBoundaryWarning(false);
                    boundaryWarningTimerRef.current = 7;
                    setBoundaryWarningTimer(7);
                }


                gunCooldown = Math.max(0, gunCooldown - delta);
                setGunOverheat(o => Math.max(0, o - 15 * delta));
                
                if ((keysPressed['mouse0'] || keysPressed[' ']) && gunCooldown <= 0 && gunOverheat < 100) {
                    gunCooldown = 0.1;
                    setGunOverheat(o => o + 5);

                    if (playerRef.current) {
                        const bulletOffset = new THREE.Vector3(0, 0, -2).applyQuaternion(playerRef.current.quaternion);
                        const bulletPos = playerRef.current.position.clone().add(bulletOffset);
                        const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                        const bullet = new THREE.Mesh(bulletGeo, bulletMat);
                        bullet.position.copy(bulletPos);
                        bullet.quaternion.copy(playerRef.current.quaternion);
                        const bulletWorldVelocity = new THREE.Vector3(0, 0, -200).applyQuaternion(playerRef.current.quaternion);
                        playerBulletsRef.current.push({ mesh: bullet, velocity: bulletWorldVelocity, ownerId: playerId || 'offline' });
                        scene.add(bullet);
                    }
                }
                
                if (mode === 'offline') {
                    for (let i = enemiesRef.current.length - 1; i >= 0; i--) {
                        const enemy = enemiesRef.current[i];
                        if (!playerRef.current) continue;
                        const targetPosition = playerRef.current.position.clone();
                        const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(enemy.mesh.position, targetPosition, enemy.mesh.up));
                        enemy.mesh.quaternion.slerp(targetQuaternion, 0.02);
                        const enemyForward = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.mesh.quaternion);
                        enemy.mesh.position.add(enemyForward.clone().multiplyScalar(25 * delta));
                        enemy.gunCooldown -= delta;
                        if(enemy.gunCooldown <=0) {
                             enemy.gunCooldown = 2.0;
                        }
                    }
                }
            }

            for (let i = playerBulletsRef.current.length - 1; i >= 0; i--) {
                const b = playerBulletsRef.current[i];
                b.mesh.position.add(b.velocity.clone().multiplyScalar(delta));
                let hit = false;

                if (mode === 'offline') {
                    for (let j = enemiesRef.current.length - 1; j >= 0; j--) {
                        const enemy = enemiesRef.current[j];
                        if (b.mesh.position.distanceTo(enemy.mesh.position) < 5) {
                            hit = true;
                            enemy.health -= 25;
                            if (enemy.health <= 0) {
                                scene.remove(enemy.mesh);
                                enemiesRef.current.splice(j, 1);
                                setScore(s => s + 150);
                                if (enemiesRef.current.length === 0 && gameStateRef.current === 'playing') {
                                    const nextWave = waveRef.current + 1;
                                    setWave(nextWave);
                                    startNewWave(nextWave);
                                }
                            }
                            break;
                        }
                    }
                } else if (mode === 'online' && serverIdProp && playerId) {
                    for (const otherPlayerId in otherPlayersRef.current) {
                        if(otherPlayerId === b.ownerId) continue;
                        
                        const otherPlayer = otherPlayersRef.current[otherPlayerId];
                         if (b.mesh.position.distanceTo(otherPlayer.mesh.position) < 5 && otherPlayer.health > 0) {
                            hit = true;
                            
                            runTransaction(db, async (transaction) => {
                                const shooterPlayerDocRef = doc(db, 'servers', serverIdProp, 'players', b.ownerId);
                                const targetPlayerDocRef = doc(db, 'servers', serverIdProp, 'players', otherPlayerId);
                                
                                const targetPlayerDoc = await transaction.get(targetPlayerDocRef);
                                if (!targetPlayerDoc.exists()) return;

                                const newHealth = Math.max(0, (targetPlayerDoc.data().health || 0) - 10);
                                transaction.update(targetPlayerDocRef, { health: newHealth });
                                
                                if (newHealth <= 0 && targetPlayerDoc.data().health > 0) {
                                    const shooterPlayerDoc = await transaction.get(shooterPlayerDocRef);
                                    if(shooterPlayerDoc.exists()) {
                                        const myKills = (shooterPlayerDoc.data().kills || 0) + 1;
                                        transaction.update(shooterPlayerDocRef, { kills: myKills });
                                    }
                                }
                            }).catch(e => console.error("Hit transaction failed: ", e));
                            
                            break;
                        }
                    }
                }

                if (hit || (playerRef.current && b.mesh.position.distanceTo(playerRef.current.position) > 2000)) {
                    scene.remove(b.mesh);
                    playerBulletsRef.current.splice(i, 1);
                }
            }

            if (mode === 'offline') {
                for (let i = enemyBulletsRef.current.length - 1; i >= 0; i--) {
                    const b = enemyBulletsRef.current[i];
                    b.mesh.position.add(b.velocity.clone().multiplyScalar(delta));
                    if (playerRef.current && b.mesh.position.distanceTo(playerRef.current.position) < 5) {
                        setPlayerHealth(h => {
                            const newHealth = Math.max(0, h - 10);
                            if (newHealth <= 0 && gameStateRef.current === 'playing') setGameState('gameover');
                            return newHealth;
                        });
                        scene.remove(b.mesh);
                        enemyBulletsRef.current.splice(i, 1);
                    } else if(playerRef.current && b.mesh.position.distanceTo(playerRef.current.position) > 2000) {
                         scene.remove(b.mesh);
                         enemyBulletsRef.current.splice(i, 1);
                    }
                }
            }


            if (playerRef.current) {
                const idealOffset = cameraOffset.clone().applyQuaternion(playerRef.current.quaternion);
                const idealPosition = playerRef.current.position.clone().add(idealOffset);
                camera.position.lerp(idealPosition, 0.1);
                camera.lookAt(playerRef.current.position);
            }

            renderer.render(scene, camera);
        };
        
        const handleKeyDown = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = false; };
        const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = true; };
        const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = false; };
        
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('resize', handleResize);
        
        if(mode === 'offline') resetGame();
        
        gameLoop(performance.now());

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            if(mountRef.current && renderer.domElement) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
            
            Object.values(otherPlayersRef.current).forEach(p => scene.remove(p.mesh));
            otherPlayersRef.current = {};
            playerBulletsRef.current.forEach(b => scene.remove(b.mesh));
            playerBulletsRef.current = [];
        };
    }, [mode, startGame]);

    // This effect sets up the Firestore listener for player data.
    // It depends on `playerId` to ensure it only runs once we have a valid player ID.
    useEffect(() => {
        if (mode !== 'online' || !serverIdProp || !playerId) return;

        const playersCollection = collection(db, 'servers', serverIdProp, 'players');
        const unsubFirestore = onSnapshot(playersCollection, (snapshot) => {
            if (!sceneRef.current) return;
            const scene = sceneRef.current;

            snapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                const id = change.doc.id;

                if (id === playerId) { // It's me
                    if (playerHealth > data.health) setPlayerHealth(data.health);
                    if (data.health <= 0 && gameStateRef.current === 'playing') setGameState('gameover');
                    if (score !== data.kills) setScore(data.kills);
                    return;
                }

                const playerMesh = otherPlayersRef.current[id]?.mesh;

                if (change.type === 'added') {
                    if (!playerMesh) {
                        const newPlayerPlane = createVoxelPlane(new THREE.Color(0xffaa00));
                        if (data.position) newPlayerPlane.position.set(data.position.x, data.position.y, data.position.z);
                        if (data.quaternion) newPlayerPlane.quaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
                        scene.add(newPlayerPlane);
                        otherPlayersRef.current[id] = { mesh: newPlayerPlane, name: data.name || 'Unknown', health: data.health || 100 };
                    }
                } else if (change.type === 'modified') {
                    if (playerMesh) {
                        if(data.position) playerMesh.position.lerp(new THREE.Vector3(data.position.x, data.position.y, data.position.z), 0.3);
                        if(data.quaternion) playerMesh.quaternion.slerp(new THREE.Quaternion(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w), 0.3);
                        otherPlayersRef.current[id].health = data.health;
                    }
                } else if (change.type === 'removed') {
                    if (playerMesh) {
                        scene.remove(playerMesh);
                        delete otherPlayersRef.current[id];
                    }
                }
            });
        });

        return () => unsubFirestore();
    }, [mode, serverIdProp, playerId, playerHealth, score]);

    const inviteLink = serverIdProp ? `${typeof window !== 'undefined' ? window.location.origin : ''}/online` : '';

    return (
        <div className="relative w-screen h-screen bg-background overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
            <div ref={mountRef} className="absolute top-0 left-0 w-full h-full" />
            
            <div 
                className="absolute inset-0 bg-white z-10 pointer-events-none"
                style={{ opacity: whiteoutOpacity, transition: 'opacity 0.5s' }}
            />

            {gameState === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-20">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    <p className="text-xl mt-4 font-headline">{mode === 'online' ? 'Joining Server...' : 'Loading Voxel Skies...'}</p>
                </div>
            )}
            
            {gameState === 'playing' && mode === 'online' && (
                <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" size="icon" className="h-10 w-10 rounded-full bg-black/30 text-white border-primary/50 backdrop-blur-sm hover:bg-primary/50">
                                <Share2 className="h-5 w-5"/>
                                <span className="sr-only">Invite</span>
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Invite Your Squadron</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Share this link with friends. They will join the first available server.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="flex items-center space-x-2">
                                <Input value={inviteLink} readOnly />
                                <Button onClick={copyInviteLink}>Copy</Button>
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Close</AlertDialogCancel>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <Button onClick={handleLeaveGame} variant="outline" size="icon" className="h-10 w-10 rounded-full bg-black/30 text-white border-primary/50 backdrop-blur-sm hover:bg-destructive/50">
                        <Home className="h-5 w-5"/>
                        <span className="sr-only">Home</span>
                    </Button>
                </div>
            )}


            {gameState === 'menu' && mode === 'offline' && (
                 <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
                        <CardHeader><CardTitle className="text-5xl font-bold font-headline text-primary">Ready for Takeoff?</CardTitle></CardHeader>
                        <CardContent className="p-8 pt-0">
                            <p className="text-muted-foreground mb-6">Use WASD to steer, Shift for boost, and Left Click or Space to fire. Good luck!</p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={() => setGameState('playing')}>Start Flight</Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showAltitudeWarning && (
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-20 text-center">
                    <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: ALTITUDE CRITICAL</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Descend below 220m immediately!</p>
                            <p className="text-5xl font-mono font-bold mt-2">
                                {altitudeWarningTimer.toFixed(1)}
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showBoundaryWarning && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 text-center">
                    <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: LEAVING BATTLEFIELD</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Return to the combat zone!</p>
                            <p className="text-5xl font-mono font-bold mt-2">
                                {boundaryWarningTimer.toFixed(1)}
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {gameState === 'playing' && <HUD score={score} wave={wave} health={playerHealth} overheat={gunOverheat} altitude={altitude} mode={mode} serverId={serverIdProp} />}

            {gameState === 'gameover' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                     <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-destructive/50 shadow-xl text-center">
                        <CardHeader><CardTitle className="text-5xl font-bold font-headline text-destructive">Shot Down!</CardTitle></CardHeader>
                        <CardContent className="p-8 pt-0">
                            {mode === 'offline' ? 
                                <p className="text-foreground mb-2">You survived to <span className="font-bold text-accent">Wave {wave}</span> with a final score of <span className="font-bold text-accent">{score}</span></p>
                                :
                                <p className="text-foreground mb-6">You were shot down. Your kill streak has been reset.</p>
                             }
                            <Button size="lg" className="w-full text-lg py-6" onClick={startGame}>Play Again</Button>
                             {mode === 'online' && (
                                <Button size="lg" variant="secondary" className="w-full text-lg py-6 mt-2" onClick={handleLeaveGame}>Back to Menu</Button>
                            )}
                             {mode === 'offline' && (
                                <Button size="lg" variant="secondary" className="w-full text-lg py-6 mt-2" onClick={() => {resetGame(); setGameState('menu');}}>Back to Menu</Button>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
