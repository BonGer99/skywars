
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
import { doc, runTransaction, onSnapshot, collection, addDoc, serverTimestamp, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';


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
    behavior: OpponentBehaviorOutput;
    gunCooldown: number;
};

type OtherPlayer = {
    mesh: THREE.Group;
    name: string;
    health: number;
};

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
    
    // THREE.js & Game Object Refs
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const playerRef = useRef<THREE.Group | null>(null);
    const bulletsRef = useRef<Bullet[]>([]);
    const enemiesRef = useRef<Enemy[]>([]);
    const otherPlayersRef = useRef<Record<string, OtherPlayer>>({});
    const cameraOffsetRef = useRef(new THREE.Vector3(0, 8, 15));
    const lastUpdateTimeRef = useRef(0);

    // Sync state to ref for use in game loop
    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    useEffect(() => {
        waveRef.current = wave;
    }, [wave]);
    
    // ---- GAME ACTIONS ----

    const handleLeaveGame = useCallback(() => {
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

    const resetGame = useCallback((isFirstLoad = false) => {
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
        altitudeWarningTimerRef.current = 5;
        setShowBoundaryWarning(false);
        setBoundaryWarningTimer(7);
        boundaryWarningTimerRef.current = 7;
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

                if (playerRef.current && cameraRef.current) {
                    const idealOffset = cameraOffsetRef.current.clone().applyQuaternion(playerRef.current.quaternion);
                    const idealPosition = playerRef.current.position.clone().add(idealOffset);
                    cameraRef.current.position.copy(idealPosition);
                    cameraRef.current.lookAt(playerRef.current.position);
                }
                
                setGameState('playing');

            } catch (error) {
                 console.error("Error restarting game:", error);
                 toast({ title: "Error", description: "Could not restart the game.", variant: "destructive" });
            }
        }
    }, [mode, serverIdProp, toast, resetGame]);

    // ---- MAIN GAME SETUP EFFECT ----
    useEffect(() => {
        if (typeof window === 'undefined' || !mountRef.current) return;
        
        const mount = mountRef.current;
        let animationFrameId: number;
        let isMounted = true;

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
            if (!mount) return;
            const width = mount.clientWidth;
            const height = mount.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };
        handleResize();
        
        const player = createVoxelPlane(new THREE.Color(0x0077ff));
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
            mesh.position.set((Math.random() - 0.5) * 1800, isTree ? 5 : 2, (Math.random() - 0.5) * 1800);
            if (isTree) mesh.position.y = -45; else mesh.position.y = -48;
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
        
        const gameLoop = (time: number) => {
            animationFrameId = requestAnimationFrame(gameLoop);
            const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
            lastTime = time;

            // Only run game logic when playing
            if (gameStateRef.current === 'playing' && playerRef.current) {
                const PITCH_SPEED = 1.2;
                const ROLL_SPEED = 1.8;
                const YAW_SPEED = 1.0;
                const BASE_SPEED = 60;
                const BOOST_MULTIPLIER = 2.0;

                // Player Controls
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

                // Altitude and Boundary checks
                const currentAltitude = playerRef.current.position.y - ground.position.y;
                setAltitude(currentAltitude);
                if (currentAltitude <= 0 && playerHealth > 0) {
                    setPlayerHealth(0); 
                    if (gameStateRef.current === 'playing') setGameState('gameover');
                }

                // Shooting logic
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
                         
                         // Create local bullet
                         const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                         const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                         const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                         bulletMesh.position.copy(bulletPos);
                         bulletMesh.quaternion.copy(bulletQuat);

                         bulletsRef.current.push({
                            id: bulletId,
                            mesh: bulletMesh,
                            velocity: bulletVelocity,
                            ownerId: playerIdRef.current,
                            spawnTime: performance.now(),
                         });
                         scene.add(bulletMesh);


                         if(mode === 'online' && serverIdProp) {
                            addDoc(collection(db, 'servers', serverIdProp, 'bullets'), {
                                ownerId: playerIdRef.current,
                                position: { x: bulletPos.x, y: bulletPos.y, z: bulletPos.z },
                                quaternion: { x: bulletQuat.x, y: bulletQuat.y, z: bulletQuat.z, w: bulletQuat.w },
                                timestamp: serverTimestamp(),
                            }).catch(console.error);
                         }
                    }
                }
            }

            // Bullet updates
            for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
                const bullet = bulletsRef.current[i];
                bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));

                // Despawn bullets after some time
                if (performance.now() - bullet.spawnTime > 5000) {
                    scene.remove(bullet.mesh);
                    bulletsRef.current.splice(i, 1);
                }
            }

            // Update camera
            if (playerRef.current) {
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
        window.addEventListener('resize', handleResize);
        
        // ---- 3. Asynchronous Game Initialization ----
        const initializeGame = async () => {
            if (!isMounted || !playerRef.current || !cameraRef.current) return;
            resetGame(true);

            if (mode === 'offline') {
                setGameState('menu');
            } else if (mode === 'online' && serverIdProp && playerNameProp) {
                try {
                    const serverRef = doc(db, 'servers', serverIdProp);
                    const randomPos = { x: (Math.random() - 0.5) * 500, y: 50, z: (Math.random() - 0.5) * 500 };
                    
                    const playerDocRef = await addDoc(collection(db, `servers/${serverIdProp}/players`), {
                        name: playerNameProp,
                        joinedAt: serverTimestamp(),
                        kills: 0,
                        health: 100,
                        position: randomPos,
                        quaternion: { x: 0, y: 0, z: 0, w: 1 },
                    });
                    
                    playerIdRef.current = playerDocRef.id;
                    playerRef.current.position.set(randomPos.x, randomPos.y, randomPos.z);
                    playerRef.current.quaternion.set(0, 0, 0, 1);
                    
                    await runTransaction(db, async (transaction) => {
                        const freshServerDoc = await transaction.get(serverRef);
                        if (!freshServerDoc.exists()) throw new Error("Server does not exist!");
                        const newPlayerCount = (freshServerDoc.data().players || 0) + 1;
                        transaction.update(serverRef, { players: newPlayerCount });
                    });
                    
                    // CRITICAL FIX: Position camera only after player is placed
                    const idealOffset = cameraOffsetRef.current.clone().applyQuaternion(playerRef.current.quaternion);
                    const idealPosition = playerRef.current.position.clone().add(idealOffset);
                    cameraRef.current.position.copy(idealPosition);
                    cameraRef.current.lookAt(playerRef.current.position);

                    if (isMounted) {
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

        // ---- 4. Cleanup ----
        return () => {
            isMounted = false;
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            
            // CRITICAL FIX: Robust session cleanup
            const pid = playerIdRef.current;
            if (mode === 'online' && serverIdProp && pid) {
                const playerDocRef = doc(db, 'servers', serverIdProp, 'players', pid);
                const serverRef = doc(db, 'servers', serverIdProp);
                runTransaction(db, async (transaction) => {
                    const serverDoc = await transaction.get(serverRef);
                    if (serverDoc.exists()) {
                        const currentPlayers = serverDoc.data().players || 1;
                        const newPlayerCount = Math.max(0, currentPlayers - 1);
                        transaction.update(serverRef, { players: newPlayerCount });
                    }
                    transaction.delete(playerDocRef);
                }).catch(e => console.error("Error during cleanup transaction:", e));
            }

            if(mountRef.current && renderer.domElement) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
            scene.traverse(object => {
                if (object instanceof THREE.Mesh) {
                    if (object.geometry) object.geometry.dispose();
                    if (object.material) {
                        if (Array.isArray(object.material)) {
                            object.material.forEach(material => material.dispose());
                        } else {
                            object.material.dispose();
                        }
                    }
                }
            });
            scene.clear();
        };
    }, []); // <-- EMPTY DEPENDENCIES: This effect runs ONCE on mount.

    // ---- FIRESTORE LISTENERS ----
    useEffect(() => {
        if (mode !== 'online' || !serverIdProp) return;
        const playersCollection = collection(db, 'servers', serverIdProp, 'players');
        const unsubFirestore = onSnapshot(playersCollection, (snapshot) => {
            if (!sceneRef.current) return;
            const scene = sceneRef.current;
            const myId = playerIdRef.current;

            const activePlayerIds = new Set<string>();
            snapshot.docs.forEach(doc => activePlayerIds.add(doc.id));

            // Remove players who are no longer in the server data
            for (const id in otherPlayersRef.current) {
                if (!activePlayerIds.has(id)) {
                    const playerMesh = otherPlayersRef.current[id]?.mesh;
                    if (playerMesh) {
                        scene.remove(playerMesh);
                    }
                    delete otherPlayersRef.current[id];
                }
            }
            
            snapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                const id = change.doc.id;

                if (id === myId) {
                    if (playerHealth !== data.health) setPlayerHealth(data.health);
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
    }, [mode, serverIdProp, playerHealth, score]);

    useEffect(() => {
        if (mode !== 'online' || !serverIdProp) return;
        const q = collection(db, 'servers', serverIdProp, 'bullets');
        const unsubBullets = onSnapshot(q, (snapshot) => {
             if (!sceneRef.current || !playerRef.current) return;
             const myId = playerIdRef.current;
             snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const bulletData = change.doc.data();
                    const docId = change.doc.id;

                    if (bulletData.ownerId === myId) return;

                    const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
                    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                    bulletMesh.position.set(bulletData.position.x, bulletData.position.y, bulletData.position.z);
                    bulletMesh.quaternion.set(bulletData.quaternion.x, bulletData.quaternion.y, bulletData.quaternion.z, bulletData.quaternion.w);
                    const velocity = new THREE.Vector3(0, 0, -200).applyQuaternion(bulletMesh.quaternion);
                    
                    bulletsRef.current.push({
                        id: docId,
                        mesh: bulletMesh,
                        velocity: velocity,
                        ownerId: bulletData.ownerId,
                        spawnTime: performance.now(),
                    });
                    sceneRef.current?.add(bulletMesh);
                    
                    setTimeout(() => {
                        deleteDoc(doc(db, 'servers', serverIdProp, 'bullets', docId)).catch(console.error);
                    }, 5000)
                }
             });
        });
        return () => unsubBullets();
    }, [mode, serverIdProp]);

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
