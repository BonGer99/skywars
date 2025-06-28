
'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Home, Share2 } from 'lucide-react';
import { generateOpponentBehavior, type OpponentBehaviorOutput } from '@/ai/flows/ai-opponent-behavior';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast";
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, addDoc, serverTimestamp, deleteDoc, updateDoc, writeBatch, getDoc, runTransaction, increment, query, orderBy, limit, where, getDocs } from 'firebase/firestore';


type GameState = 'loading' | 'menu' | 'playing' | 'gameover';
type GameMode = 'offline' | 'online';

interface GameProps {
  mode: GameMode;
  serverId?: string;
  playerName?: string;
}

type Bullet = {
    id: string;
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    ownerId: string;
    spawnTime: number;
};

type Enemy = {
    mesh: THREE.Group;
    health: number;
    behavior: OpponentBehaviorOutput | null;
    gunCooldown: number;
    nextBehaviorUpdate: number;
    targetPosition: THREE.Vector3;
};

type OtherPlayer = {
    mesh: THREE.Group;
    name: string;
    health: number;
};

const createVoxelPlane = (color: THREE.ColorRepresentation) => {
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

    const hitboxGeo = new THREE.BoxGeometry(9, 3, 5);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.name = 'hitbox';
    plane.add(hitbox);
    
    return plane;
};

const MAX_ALTITUDE = 220;
const BOUNDARY = 950;
const TARGET_PLAYER_COUNT = 8;


export default function Game({ mode, serverId: serverIdProp, playerName: playerNameProp }: GameProps) {
    const mountRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const { toast } = useToast();

    // Core Game State
    const [gameState, setGameState] = useState<GameState>('loading');
    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(1);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [gunOverheat, setGunOverheat] = useState(0);
    const [altitude, setAltitude] = useState(0);
    const [isHost, setIsHost] = useState(false);

    // Warning UI State
    const [showAltitudeWarning, setShowAltitudeWarning] = useState(false);
    const [altitudeWarningTimer, setAltitudeWarningTimer] = useState(5);
    const [showBoundaryWarning, setShowBoundaryWarning] = useState(false);
    const [boundaryWarningTimer, setBoundaryWarningTimer] = useState(7);
    const [whiteoutOpacity, setWhiteoutOpacity] = useState(0);
    
    // Mutable Refs for state inside the game loop
    const playerIdRef = useRef<string | null>(null);
    const gameStateRef = useRef(gameState);
    const waveRef = useRef(wave);
    const altitudeWarningTimerRef = useRef(altitudeWarningTimer);
    const boundaryWarningTimerRef = useRef(boundaryWarningTimer);
    const gameInitializedRef = useRef(false);
    
    // THREE.js & Game Object Refs
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const playerRef = useRef<THREE.Group | null>(null);
    const bulletsRef = useRef<Bullet[]>([]);
    const enemiesRef = useRef<Enemy[]>([]); // Offline mode enemies
    const aiOpponentsRef = useRef<Record<string, Enemy>>({}); // Online mode AI
    const otherPlayersRef = useRef<Record<string, OtherPlayer>>({});
    const cameraOffsetRef = useRef(new THREE.Vector3(0, 8, 15));
    const lastUpdateTimeRef = useRef(0);
    const hostIntervalRef = useRef<NodeJS.Timeout | null>(null);


    // Sync state to ref for use in game loop
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { waveRef.current = wave; }, [wave]);
    useEffect(() => { altitudeWarningTimerRef.current = altitudeWarningTimer; }, [altitudeWarningTimer]);
    useEffect(() => { boundaryWarningTimerRef.current = boundaryWarningTimer; }, [boundaryWarningTimer]);
    
    const handleLeaveGame = useCallback(() => { router.push('/'); }, [router]);

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

    const handlePlayerHit = useCallback(async (hitPlayerId: string, damage: number) => {
        if (!serverIdProp || !playerIdRef.current || hitPlayerId === playerIdRef.current) return;

        const hitPlayerDocRef = doc(db, 'servers', serverIdProp, 'players', hitPlayerId);
        const myPlayerDocRef = doc(db, 'servers', serverIdProp, 'players', playerIdRef.current);
    
        try {
            await runTransaction(db, async (transaction) => {
                const hitPlayerDoc = await transaction.get(hitPlayerDocRef);
                if (!hitPlayerDoc.exists()) { throw "Hit player document does not exist!"; }
    
                const currentHealth = hitPlayerDoc.data().health;
                if (currentHealth <= 0) { return; }
                const newHealth = Math.max(0, currentHealth - damage);
    
                transaction.update(hitPlayerDocRef, { health: newHealth });
    
                if (currentHealth > 0 && newHealth === 0) {
                    transaction.update(myPlayerDocRef, { kills: increment(1) });
                    
                    // If an AI was killed by a player, reset it
                    if (hitPlayerDoc.data().isAI) {
                        const randomPos = { x: (Math.random() - 0.5) * 800, y: 50, z: (Math.random() - 0.5) * 800 };
                         transaction.update(hitPlayerDocRef, {
                            health: 100,
                            position: randomPos,
                            quaternion: { x: 0, y: 0, z: 0, w: 1 },
                        });
                    }
                }
            });
        } catch (e) {
            console.error("Player hit transaction failed: ", e);
        }
    }, [serverIdProp]);

    const resetGame = useCallback(() => {
        if (!playerRef.current || !sceneRef.current) return;
        
        playerRef.current.position.set(0, 50, 0);
        playerRef.current.rotation.set(0, 0, 0);
        playerRef.current.quaternion.set(0, 0, 0, 1);
        
        bulletsRef.current.forEach(b => sceneRef.current?.remove(b.mesh));
        bulletsRef.current = [];
        
        if (mode === 'offline') {
            enemiesRef.current.forEach(e => sceneRef.current?.remove(e.mesh));
            enemiesRef.current = [];
            setScore(0);
            setWave(1);
        }

        setPlayerHealth(100);
        setGunOverheat(0);
        setAltitude(playerRef.current.position.y - (-50));
        setShowAltitudeWarning(false);
        setAltitudeWarningTimer(5);
        setShowBoundaryWarning(false);
        setBoundaryWarningTimer(7);
        setWhiteoutOpacity(0);
    }, [mode]);

    const handlePlayAgain = useCallback(async () => {
        resetGame();
        if(mode === 'offline') {
            setWave(1);
            setScore(0);
            setGameState('playing');
        } else if(mode === 'online' && serverIdProp && playerIdRef.current) {
            const playerDocRef = doc(db, 'servers', serverIdProp, 'players', playerIdRef.current);
            const randomPos = { x: (Math.random() - 0.5) * 800, y: 50, z: (Math.random() - 0.5) * 800 };
            try {
                await updateDoc(playerDocRef, {
                    health: 100,
                    kills: 0,
                    position: randomPos,
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                });

                if (playerRef.current) {
                    playerRef.current.position.set(randomPos.x, randomPos.y, randomPos.z);
                    playerRef.current.quaternion.set(0,0,0,1);
                }
                
                setGameState('playing');

            } catch (error) {
                 console.error("Error restarting game:", error);
                 toast({ title: "Error", description: "Could not restart the game.", variant: "destructive" });
            }
        }
    }, [mode, serverIdProp, toast, resetGame]);

    // This effect runs once to set up the entire game
    useEffect(() => {
        if (typeof window === 'undefined' || !mountRef.current) return;
        
        const mount = mountRef.current;
        let animationFrameId: number;
        let isMounted = true;
        let heartbeatInterval: NodeJS.Timeout;
        let unsubPlayers: () => void;
        let unsubBullets: () => void;

        // ---- 1. Synchronous Three.js Setup ----
        const scene = new THREE.Scene();
        sceneRef.current = scene;
        scene.background = new THREE.Color(0x87CEEB); 
        scene.fog = new THREE.Fog(0x87CEEB, 1000, 2500);

        const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 4000);
        cameraRef.current = camera;
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
        renderer.setPixelRatio(window.devicePixelRatio);
        mount.appendChild(renderer.domElement);
        
        const handleResize = () => {
            if (!mount || !isMounted) return;
            const width = mount.clientWidth;
            const height = mount.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        
        const player = createVoxelPlane(0x0077ff); // Player is blue
        playerRef.current = player;
        scene.add(player);

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
        
        const scenery = new THREE.Group();
        for (let i = 0; i < 75; i++) {
            const isTree = Math.random() > 0.3;
            const mesh = new THREE.Mesh(
                isTree ? new THREE.ConeGeometry(3, 10, 6) : new THREE.SphereGeometry(2, 6, 6),
                new THREE.MeshLambertMaterial({ color: isTree ? 0x228B22 : 0x8B4513, flatShading: true })
            );
            mesh.position.set((Math.random() - 0.5) * 1800, isTree ? -45 : -48, (Math.random() - 0.5) * 1800);
            scenery.add(mesh);
        }
        scene.add(scenery);

        const cloudLayer = new THREE.Group();
        for (let i = 0; i < 150; i++) {
            const cloudGeo = new THREE.SphereGeometry(Math.random() * 15 + 10, 8, 8);
            const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
            const cloud = new THREE.Mesh(cloudGeo, cloudMat);
            cloud.position.set((Math.random() - 0.5) * 2000, Math.random() * 100 + 150, (Math.random() - 0.5) * 2000);
            cloudLayer.add(cloud);
        }
        scene.add(cloudLayer);

        // ---- 2. Game Logic and Loop Definition ----
        const keysPressed: Record<string, boolean> = {};
        let gunCooldown = 0;
        let lastTime = 0;

        const manageAIPopulation = async () => {
             if (!serverIdProp) return;
             const playersCollectionRef = collection(db, 'servers', serverIdProp, 'players');
            
             try {
                await runTransaction(db, async (transaction) => {
                    const allPlayersSnapshot = await transaction.get(query(playersCollectionRef));
                    const humanPlayers = allPlayersSnapshot.docs.filter(doc => !doc.data().isAI);
                    const aiPlayers = allPlayersSnapshot.docs.filter(doc => doc.data().isAI);
                    const totalPlayers = humanPlayers.length + aiPlayers.length;

                    if (totalPlayers < TARGET_PLAYER_COUNT) {
                        const numAIToAdd = TARGET_PLAYER_COUNT - totalPlayers;
                        for (let i = 0; i < numAIToAdd; i++) {
                            const newAiRef = doc(playersCollectionRef);
                            const randomPos = { x: (Math.random() - 0.5) * 1500, y: Math.random() * 100 + 50, z: (Math.random() - 0.5) * 1500 };
                            transaction.set(newAiRef, {
                                name: `AI Pilot ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random()*100)}`,
                                isAI: true,
                                joinedAt: serverTimestamp(),
                                lastSeen: serverTimestamp(),
                                kills: 0,
                                health: 100,
                                position: randomPos,
                                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                            });
                        }
                    } else if (totalPlayers > TARGET_PLAYER_COUNT) {
                        const numAIToRemove = totalPlayers - TARGET_PLAYER_COUNT;
                        const aiToRemove = aiPlayers.slice(0, numAIToRemove);
                        aiToRemove.forEach(aiDoc => {
                            transaction.delete(aiDoc.ref);
                        });
                    }
                });
             } catch (error) {
                console.error("Error managing AI population: ", error);
             }
        };

        const electHost = async () => {
            if (!serverIdProp || !playerIdRef.current) return false;
            const playersQuery = query(collection(db, `servers/${serverIdProp}/players`), where("isAI", "!=", true), orderBy("joinedAt"), limit(1));
            const snapshot = await getDocs(playersQuery);
            if (!snapshot.empty) {
                const hostId = snapshot.docs[0].id;
                const amIHost = hostId === playerIdRef.current;
                setIsHost(amIHost);
                return amIHost;
            }
            return false;
        };

        const gameLoop = (time: number) => {
            if (!isMounted) return;
            animationFrameId = requestAnimationFrame(gameLoop);
            const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
            lastTime = time;

            if (gameStateRef.current === 'playing' && playerRef.current) {
                const PITCH_SPEED = 1.2;
                const ROLL_SPEED = 1.8;
                const YAW_SPEED = 1.0;
                const BASE_SPEED = 60;
                const BOOST_MULTIPLIER = 2.0;

                // Player Controls
                if (keysPressed['w'] || keysPressed['W']) playerRef.current.rotateX(-PITCH_SPEED * delta);
                if (keysPressed['s'] || keysPressed['S']) playerRef.current.rotateX(PITCH_SPEED * delta);
                if (keysPressed['a'] || keysPressed['A']) { playerRef.current.rotateZ(ROLL_SPEED * delta); playerRef.current.rotateY(YAW_SPEED * delta * 0.2); }
                if (keysPressed['d'] || keysPressed['D']) { playerRef.current.rotateZ(-ROLL_SPEED * delta); playerRef.current.rotateY(-YAW_SPEED * delta * 0.2); }
                
                let currentSpeed = BASE_SPEED;
                if (keysPressed['shift']) currentSpeed *= BOOST_MULTIPLIER;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerRef.current.quaternion);
                playerRef.current.position.add(forward.multiplyScalar(currentSpeed * delta));
                
                // Online position update
                if (mode === 'online' && playerIdRef.current && serverIdProp) {
                    const now = performance.now();
                    if(now - lastUpdateTimeRef.current > 100) { // Update 10 times per second
                        lastUpdateTimeRef.current = now;
                        const playerDocRef = doc(db, 'servers', serverIdProp, 'players', playerIdRef.current);
                        const { x: qx, y: qy, z: qz, w: qw } = playerRef.current.quaternion;
                        const { x: px, y: py, z: pz } = playerRef.current.position;
                        updateDoc(playerDocRef, {
                           position: { x: px, y: py, z: pz },
                           quaternion: { x: qx, y: qy, z: qz, w: qw },
                        }).catch(console.error);
                    }
                }

                const currentAltitude = playerRef.current.position.y - ground.position.y;
                setAltitude(currentAltitude);
                if (currentAltitude <= 0 && playerHealth > 0) {
                    setPlayerHealth(0); 
                    if (gameStateRef.current === 'playing') setGameState('gameover');
                }
                
                if (currentAltitude > MAX_ALTITUDE) {
                    setShowAltitudeWarning(true);
                    setAltitudeWarningTimer(t => Math.max(0, t - delta));
                    const opacity = Math.max(0, 1 - (altitudeWarningTimerRef.current / 5));
                    setWhiteoutOpacity(opacity);
                    if (altitudeWarningTimerRef.current <= 0) {
                         setPlayerHealth(0); 
                         if (gameStateRef.current === 'playing') setGameState('gameover');
                    }
                } else {
                    setShowAltitudeWarning(false);
                    setAltitudeWarningTimer(5);
                    setWhiteoutOpacity(0);
                }

                if (Math.abs(playerRef.current.position.x) > BOUNDARY || Math.abs(playerRef.current.position.z) > BOUNDARY) {
                    setShowBoundaryWarning(true);
                    setBoundaryWarningTimer(t => Math.max(0, t - delta));
                     if (boundaryWarningTimerRef.current <= 0) {
                        setPlayerHealth(0);
                        if (gameStateRef.current === 'playing') setGameState('gameover');
                    }
                } else {
                    setShowBoundaryWarning(false);
                    setBoundaryWarningTimer(7);
                }

                gunCooldown = Math.max(0, gunCooldown - delta);
                setGunOverheat(o => Math.max(0, o - 15 * delta));
                if ((keysPressed['mouse0'] || keysPressed[' ']) && gunCooldown <= 0 && gunOverheat < 100) {
                    if (playerRef.current && playerIdRef.current) {
                         gunCooldown = 0.1; 
                         setGunOverheat(o => o + 5);

                         const bulletOffset = new THREE.Vector3(0, 0, -2).applyQuaternion(playerRef.current.quaternion);
                         const bulletPos = playerRef.current.position.clone().add(bulletOffset);
                         const bulletQuat = playerRef.current.quaternion.clone();
                         const bulletVelocity = new THREE.Vector3(0, 0, -200).applyQuaternion(bulletQuat);
                         
                         const bulletId = Math.random().toString(36).substring(2, 15);
                         
                         const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                         const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                         const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                         bulletMesh.position.copy(bulletPos);
                         bulletMesh.quaternion.copy(bulletQuat);
                         scene.add(bulletMesh);

                         const newBullet = {
                            id: bulletId,
                            mesh: bulletMesh,
                            velocity: bulletVelocity,
                            ownerId: playerIdRef.current,
                            spawnTime: performance.now(),
                         };
                         bulletsRef.current.push(newBullet);

                         if(mode === 'online' && serverIdProp) {
                            addDoc(collection(db, 'servers', serverIdProp, 'bullets'), {
                                ownerId: playerIdRef.current,
                                position: { x: bulletPos.x, y: bulletPos.y, z: bulletPos.z },
                                quaternion: { x: bulletQuat.x, y: bulletQuat.y, z: bulletQuat.z, w: bulletQuat.w },
                                velocity: { x: bulletVelocity.x, y: bulletVelocity.y, z: bulletVelocity.z },
                                timestamp: serverTimestamp(),
                            }).catch(console.error);
                         }
                    }
                }
            }

            // Update AI Opponents (Host only)
            if (isHost) {
                const now = performance.now();
                const batch = writeBatch(db);
                let batchNeedsCommit = false;

                Object.entries(aiOpponentsRef.current).forEach(([id, ai]) => {
                    if (now > ai.nextBehaviorUpdate) {
                        ai.nextBehaviorUpdate = now + (15 + Math.random() * 10) * 1000;
                        generateOpponentBehavior({ waveNumber: 5, playerSkillLevel: 'intermediate' })
                            .then(behavior => {
                                ai.behavior = behavior;
                                ai.targetPosition.set((Math.random() - 0.5) * 1800, Math.random() * 150 + 50, (Math.random() - 0.5) * 1800);
                            }).catch(console.error);
                    }

                    if (ai.behavior) {
                        const direction = new THREE.Vector3().subVectors(ai.targetPosition, ai.mesh.position).normalize();
                        ai.mesh.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction), 0.05);
                        ai.mesh.position.add(new THREE.Vector3(0, 0, -1).applyQuaternion(ai.mesh.quaternion).multiplyScalar(40 * delta));

                        if (ai.mesh.position.distanceTo(ai.targetPosition) < 100) {
                           ai.nextBehaviorUpdate = 0; // Get new behavior
                        }
                    }
                     const aiDocRef = doc(db, 'servers', serverIdProp!, 'players', id);
                     batch.update(aiDocRef, {
                        position: { x: ai.mesh.position.x, y: ai.mesh.position.y, z: ai.mesh.position.z },
                        quaternion: { x: ai.mesh.quaternion.x, y: ai.mesh.quaternion.y, z: ai.mesh.quaternion.z, w: ai.mesh.quaternion.w },
                        lastSeen: serverTimestamp()
                     });
                     batchNeedsCommit = true;
                });
                if(batchNeedsCommit) batch.commit().catch(console.error);
            }


            // Bullet updates and collision detection
            for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
                const bullet = bulletsRef.current[i];
                bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));
                
                let bulletRemoved = false;

                // Player who fired bullet checks for collision
                if (bullet.ownerId === playerIdRef.current) {
                    const checkCollision = (target: OtherPlayer | Enemy, targetId: string) => {
                         const hitbox = target.mesh?.getObjectByName('hitbox');
                         if (target.health > 0 && hitbox) {
                            const targetBBox = new THREE.Box3().setFromObject(hitbox);
                            if (targetBBox.containsPoint(bullet.mesh.position)) {
                                handlePlayerHit(targetId, 10);
                                scene.remove(bullet.mesh);
                                bulletsRef.current.splice(i, 1);
                                bulletRemoved = true;
                                return true;
                            }
                        }
                        return false;
                    };
                    
                    if (mode === 'online') {
                         for (const opponentId in otherPlayersRef.current) {
                           if (checkCollision(otherPlayersRef.current[opponentId], opponentId)) break;
                         }
                         if (bulletRemoved) continue;
                         for (const aiId in aiOpponentsRef.current) {
                           if (checkCollision(aiOpponentsRef.current[aiId], aiId)) break;
                         }
                    }
                }

                if (!bulletRemoved && performance.now() - bullet.spawnTime > 5000) {
                    scene.remove(bullet.mesh);
                    bulletsRef.current.splice(i, 1);
                }
            }


            // Update camera
            if (gameInitializedRef.current && playerRef.current && cameraRef.current) {
                const idealOffset = cameraOffsetRef.current.clone().applyQuaternion(playerRef.current.quaternion);
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
        
        const initializeGame = async () => {
            if (!isMounted) return;
            resetGame();

            if (mode === 'offline') {
                playerIdRef.current = 'offline_player';
                setGameState('menu');
            } else if (mode === 'online' && serverIdProp && playerNameProp) {
                try {
                    const randomPos = { x: (Math.random() - 0.5) * 500, y: 50, z: (Math.random() - 0.5) * 500 };
                    
                    const playerDocRefHandle = await addDoc(collection(db, `servers/${serverIdProp}/players`), {
                        name: playerNameProp,
                        isAI: false,
                        joinedAt: serverTimestamp(),
                        lastSeen: serverTimestamp(),
                        kills: 0,
                        health: 100,
                        position: randomPos,
                        quaternion: { x: 0, y: 0, z: 0, w: 1 },
                    });
                    
                    playerIdRef.current = playerDocRefHandle.id;

                    const amIHost = await electHost();
                    if(amIHost) {
                       await manageAIPopulation();
                       hostIntervalRef.current = setInterval(manageAIPopulation, 15000); // Check population every 15s
                    }

                    const playersCollectionRef = collection(db, 'servers', serverIdProp, 'players');
                    unsubPlayers = onSnapshot(playersCollectionRef, (snapshot) => {
                        if (!sceneRef.current || !playerRef.current) return;
                        const scene = sceneRef.current;
                        const myId = playerIdRef.current;
                        const now = Date.now();
                        const STALE_THRESHOLD_MS = 20000; 
                        
                        const currentHumanIds = new Set(Object.keys(otherPlayersRef.current));
                        const currentAiIds = new Set(Object.keys(aiOpponentsRef.current));
                        const freshPlayerIds = new Set<string>();

                        snapshot.forEach(docSnap => {
                            const data = docSnap.data();
                            const id = docSnap.id;
                            if (id === myId) {
                                if (playerHealth !== data.health) setPlayerHealth(data.health);
                                if (data.health <= 0 && gameStateRef.current === 'playing') setGameState('gameover');
                                if (score !== data.kills) setScore(data.kills);
                                return;
                            };

                            const lastSeenTimestamp = data.lastSeen?.toDate()?.getTime();
                            if (!lastSeenTimestamp || (now - lastSeenTimestamp > STALE_THRESHOLD_MS)) {
                                return; // Skip stale players
                            }
                            freshPlayerIds.add(id);

                            if (data.isAI) {
                                let aiOpponent = aiOpponentsRef.current[id];
                                if (!aiOpponent) {
                                    const newPlane = createVoxelPlane(0xff0000); // AI is red
                                    scene.add(newPlane);
                                    aiOpponentsRef.current[id] = { mesh: newPlane, health: data.health || 100, behavior: null, gunCooldown: 5, nextBehaviorUpdate: 0, targetPosition: new THREE.Vector3() };
                                    aiOpponent = aiOpponentsRef.current[id];
                                }
                                if (data.position) aiOpponent.mesh.position.lerp(new THREE.Vector3(data.position.x, data.position.y, data.position.z), 0.3);
                                if (data.quaternion) aiOpponent.mesh.quaternion.slerp(new THREE.Quaternion(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w), 0.3);
                                aiOpponent.health = data.health;
                                currentAiIds.delete(id);
                            } else {
                                let otherPlayer = otherPlayersRef.current[id];
                                if (!otherPlayer) {
                                    const newPlayerPlane = createVoxelPlane(0xffaa00); // Other humans are orange
                                    scene.add(newPlayerPlane);
                                    otherPlayersRef.current[id] = { mesh: newPlayerPlane, name: data.name || 'Unknown', health: data.health || 100 };
                                    otherPlayer = otherPlayersRef.current[id];
                                }
                                if (data.position) otherPlayer.mesh.position.lerp(new THREE.Vector3(data.position.x, data.position.y, data.position.z), 0.3);
                                if (data.quaternion) otherPlayer.mesh.quaternion.slerp(new THREE.Quaternion(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w), 0.3);
                                otherPlayer.health = data.health;
                                currentHumanIds.delete(id);
                            }
                        });
                        
                        currentHumanIds.forEach(id => {
                            scene.remove(otherPlayersRef.current[id].mesh);
                            delete otherPlayersRef.current[id];
                        });
                        currentAiIds.forEach(id => {
                            scene.remove(aiOpponentsRef.current[id].mesh);
                            delete aiOpponentsRef.current[id];
                        });

                        electHost();
                    });
                    
                    const bulletsCollectionRef = collection(db, 'servers', serverIdProp, 'bullets');
                    unsubBullets = onSnapshot(query(bulletsCollectionRef, where("timestamp", ">", new Date())), (snapshot) => {
                         if (!sceneRef.current || !playerRef.current) return;
                         const myId = playerIdRef.current;
                         const batch = writeBatch(db);
                         snapshot.docChanges().forEach(change => {
                            if (change.type === 'added') {
                                const bulletData = change.doc.data();
                                const docId = change.doc.id;
                                if (bulletData.ownerId === myId) return;

                                const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                                const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
                                const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                                bulletMesh.position.set(bulletData.position.x, bulletData.position.y, bulletData.position.z);
                                
                                const velocity = new THREE.Vector3(bulletData.velocity.x, bulletData.velocity.y, bulletData.velocity.z);
                                
                                bulletsRef.current.push({
                                    id: docId,
                                    mesh: bulletMesh,
                                    velocity: velocity,
                                    ownerId: bulletData.ownerId,
                                    spawnTime: performance.now(),
                                });
                                sceneRef.current?.add(bulletMesh);
                                
                                batch.delete(doc(db, 'servers', serverIdProp, 'bullets', docId));
                            }
                         });
                         if (!snapshot.empty) {
                            batch.commit().catch(console.error);
                         }
                    });

                    heartbeatInterval = setInterval(() => {
                        if (playerIdRef.current) {
                            const playerDoc = doc(db, 'servers', serverIdProp, 'players', playerIdRef.current);
                            updateDoc(playerDoc, { lastSeen: serverTimestamp() }).catch(console.error);
                        }
                    }, 10000);
                    
                    if (playerRef.current) {
                        playerRef.current.position.set(randomPos.x, randomPos.y, randomPos.z);
                        playerRef.current.quaternion.set(0, 0, 0, 1);
                    }
                    if (cameraRef.current && playerRef.current) {
                        const idealOffset = cameraOffsetRef.current.clone().applyQuaternion(playerRef.current.quaternion);
                        const idealPosition = playerRef.current.position.clone().add(idealOffset);
                        cameraRef.current.position.copy(idealPosition);
                        cameraRef.current.lookAt(playerRef.current.position);
                    }

                    if (isMounted) {
                        gameInitializedRef.current = true;
                        setGameState('playing');
                    }

                } catch (error) {
                    console.error("Failed to join game:", error);
                    toast({ title: "Error Joining Server", description: "Could not join the game server. You will be redirected.", variant: "destructive" });
                    setTimeout(() => router.push('/online'), 3000);
                }
            }
        };

        initializeGame();
        gameLoop(performance.now());

        return () => {
            isMounted = false;
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            if (hostIntervalRef.current) clearInterval(hostIntervalRef.current);
            if (unsubPlayers) unsubPlayers();
            if (unsubBullets) unsubBullets();

            const pid = playerIdRef.current;
            if (mode === 'online' && serverIdProp && pid) {
                deleteDoc(doc(db, 'servers', serverIdProp, 'players', pid)).catch(e => {
                  console.warn("Could not delete player document on exit:", e.message);
                });
            }

            if(mountRef.current && renderer.domElement) {
                mountRef.current.removeChild(renderer.domElement);
            }
        };
    }, [mode, serverIdProp, playerNameProp, router, toast, resetGame, handlePlayerHit, isHost]);


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

            {showAltitudeWarning && gameState === 'playing' && (
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-20 text-center">
                    <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: ALTITUDE CRITICAL</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Descend below {MAX_ALTITUDE}m immediately!</p>
                            <p className="text-5xl font-mono font-bold mt-2">
                                {altitudeWarningTimer.toFixed(1)}
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showBoundaryWarning && gameState === 'playing' && (
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
                            <Button size="lg" className="w-full text-lg py-6" onClick={handlePlayAgain}>Play Again</Button>
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
