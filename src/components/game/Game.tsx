
'use client';

import * as THREE from 'three';
import * as Colyseus from 'colyseus.js';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Home } from 'lucide-react';
import type { VoxelAcesState } from '@/server/rooms/state/VoxelAcesState';

// Workaround for React.StrictMode, to avoid multiple join requests
let hasActiveJoinRequest = false;

// Constants
const BOUNDARY = 950;
const MAX_ALTITUDE = 220;
const GROUND_Y = -50;

// Shared physics constants (from server)
const BASE_SPEED = 60;
const BOOST_MULTIPLIER = 2.0;
const PITCH_SPEED = 2.5;
const ROLL_SPEED = 2.5;

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

    return plane;
};

type GameStatus = 'loading' | 'menu' | 'playing' | 'gameover';
type GameMode = 'offline' | 'online';

interface GameProps {
  mode: GameMode;
  playerName?: string;
}

export default function Game({ mode, playerName: playerNameProp }: GameProps) {
    const mountRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    const gameStatusRef = useRef<GameStatus>('loading');
    const setGameStatus = (status: GameStatus) => {
        gameStatusRef.current = status;
        _setGameStatus(status);
    }
    const [_gameStatus, _setGameStatus] = useState<GameStatus>('loading');
    
    const playerPlaneRef = useRef<THREE.Group | null>(null);

    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(1);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [altitude, setAltitude] = useState(0);
    
    const [showAltitudeWarning, setShowAltitudeWarning] = useState(false);
    const [altitudeWarningTimer, setAltitudeWarningTimer] = useState(5);
    const [showBoundaryWarning, setShowBoundaryWarning] = useState(false);
    const [boundaryWarningTimer, setBoundaryWarningTimer] = useState(7);
    const [whiteoutOpacity, setWhiteoutOpacity] = useState(0);
    
    const roomRef = useRef<Colyseus.Room<VoxelAcesState> | null>(null);
    const keysPressed = useRef<Record<string, boolean>>({}).current;

    const handleLeaveGame = useCallback(() => { 
      roomRef.current?.leave();
      router.push('/'); 
    }, [router]);

    const handlePlayAgain = useCallback(() => {
        if (roomRef.current) {
            roomRef.current.send("respawn");
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !mountRef.current) return;
        
        const mount = mountRef.current;
        let animationFrameId: number;
        let inputInterval: NodeJS.Timeout;
        let client: Colyseus.Client;
        let joinRequest: Promise<Colyseus.Room<VoxelAcesState>>;

        const localPlanes: Record<string, THREE.Group> = {};
        const localBullets: Record<string, THREE.Mesh> = {};

        // Offline player physics state
        const offlinePlayer = {
            position: new THREE.Vector3(0, 50, 0),
            quaternion: new THREE.Quaternion(),
        };

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB); 
        scene.fog = new THREE.Fog(0x87CEEB, 1000, 2500);
        const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 4000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        mount.appendChild(renderer.domElement);
        
        const handleResize = () => {
            if (!mountRef.current) return;
            camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        };
        handleResize();
        
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
        
        const scenery = new THREE.Group();
        scene.add(scenery);
        const cloudLayer = new THREE.Group();
        scene.add(cloudLayer);

        const createMountain = () => {
            const mountain = new THREE.Group();
            const layers = Math.floor(Math.random() * 5) + 3;
            let baseRadius = Math.random() * 50 + 40;
            let currentY = GROUND_Y;

            for (let i = 0; i < layers; i++) {
                const height = Math.random() * 30 + 20;
                const radius = baseRadius * ((layers - i) / layers);
                const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 8);
                const mat = new THREE.MeshLambertMaterial({ color: 0x6A6A6A, flatShading: true });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.y = currentY + height / 2;
                mountain.add(mesh);
                currentY += height * 0.8;
            }
            return mountain;
        }

        for (let i = 0; i < 20; i++) {
            const mountain = createMountain();
            mountain.position.set(
                (Math.random() - 0.5) * 1800,
                0,
                (Math.random() - 0.5) * 1800
            );
            scenery.add(mountain);
        }

        const createCloud = () => {
            const cloud = new THREE.Group();
            const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.8, transparent: true });
            const puffCount = Math.floor(Math.random() * 5) + 3;
            for(let i = 0; i < puffCount; i++) {
                const size = Math.random() * 40 + 20;
                const puffGeo = new THREE.BoxGeometry(size, size, size);
                const puff = new THREE.Mesh(puffGeo, mat);
                puff.position.set(
                    (Math.random() - 0.5) * 60,
                    (Math.random() - 0.5) * 20,
                    (Math.random() - 0.5) * 60
                );
                cloud.add(puff);
            }
            return cloud;
        }

        for (let i = 0; i < 50; i++) {
            const cloud = createCloud();
            cloud.position.set(
                (Math.random() - 0.5) * 1800,
                Math.random() * 100 + 80, // altitude
                (Math.random() - 0.5) * 1800
            );
            cloudLayer.add(cloud);
        }

        let lastTime = 0;

        const gameLoop = (time: number) => {
            animationFrameId = requestAnimationFrame(gameLoop);
            const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
            lastTime = time;
            
            const myId = roomRef.current?.sessionId;
            let myPlane: THREE.Group | null = null;

            if (mode === 'online') {
                myPlane = myId ? localPlanes[myId] : null;
            } else {
                myPlane = playerPlaneRef.current;
            }
            
            // --- OFFLINE MODE LOGIC ---
            if (mode === 'offline' && gameStatusRef.current === 'playing') {
                if (!myPlane) {
                    // Initialize offline game
                    const planeMesh = createVoxelPlane(0x0077ff);
                    planeMesh.position.copy(offlinePlayer.position);
                    scene.add(planeMesh);
                    playerPlaneRef.current = planeMesh;
                    myPlane = planeMesh;
                }
                
                const input = {
                    w: !!keysPressed['w'], s: !!keysPressed['s'], a: !!keysPressed['a'], d: !!keysPressed['d'],
                    shift: !!keysPressed['shift'],
                };

                if (input.w) offlinePlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -PITCH_SPEED * delta));
                if (input.s) offlinePlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PITCH_SPEED * delta));
                if (input.a) offlinePlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_SPEED * delta));
                if (input.d) offlinePlayer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ROLL_SPEED * delta));

                const speed = input.shift ? BASE_SPEED * BOOST_MULTIPLIER : BASE_SPEED;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(offlinePlayer.quaternion);
                offlinePlayer.position.add(forward.multiplyScalar(speed * delta));

                myPlane.position.copy(offlinePlayer.position);
                myPlane.quaternion.copy(offlinePlayer.quaternion);
            }
            // --- END OFFLINE MODE LOGIC ---

            if (gameStatusRef.current === 'playing' && myPlane) {
                const currentAltitude = myPlane.position.y - ground.position.y;
                setAltitude(currentAltitude);
                
                let altWarn = false;
                if (currentAltitude > MAX_ALTITUDE) {
                    altWarn = true;
                    setAltitudeWarningTimer(t => Math.max(0, t - delta));
                    const opacity = Math.max(0, 1 - (altitudeWarningTimer / 5));
                    setWhiteoutOpacity(opacity);
                } else {
                    setAltitudeWarningTimer(5);
                    setWhiteoutOpacity(0);
                }
                setShowAltitudeWarning(altWarn && gameStatusRef.current === 'playing');

                let boundaryWarn = false;
                if (Math.abs(myPlane.position.x) > BOUNDARY || Math.abs(myPlane.position.z) > BOUNDARY) {
                   boundaryWarn = true;
                   setBoundaryWarningTimer(t => Math.max(0, t - delta));
                } else {
                   setBoundaryWarningTimer(7);
                }
                setShowBoundaryWarning(boundaryWarn && gameStatusRef.current === 'playing');

                const cameraOffset = new THREE.Vector3(0, 8, 15);
                const idealOffset = cameraOffset.clone().applyQuaternion(myPlane.quaternion);
                const idealPosition = myPlane.position.clone().add(idealOffset);
                camera.position.lerp(idealPosition, 0.1);
                camera.lookAt(myPlane.position);
            }
            
            renderer.render(scene, camera);
        };
        
        const handleKeyDown = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = false; };
        const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = true; };
        const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = false; };
        
        if (mode === 'online') {
            if (hasActiveJoinRequest) return;
            hasActiveJoinRequest = true;

            const protocol = window.location.protocol === "https:" ? "wss" : "ws";
            const endpoint = `${protocol}://${window.location.host}`;
            client = new Colyseus.Client(endpoint);
            
            joinRequest = client.joinOrCreate<VoxelAcesState>("voxel_aces_room", { playerName: playerNameProp });

            joinRequest.then(room => {
                roomRef.current = room;
                setGameStatus('playing');

                room.onLeave(() => {
                    console.log("Disconnected from room.");
                    if (gameStatusRef.current !== 'gameover') {
                       setGameStatus('gameover'); 
                    }
                });

                room.state.players.onAdd((player, sessionId) => {
                    const isMe = sessionId === room.sessionId;
                    const color = isMe ? 0x0077ff : 0xffaa00;
                    const planeMesh = createVoxelPlane(color);
                    
                    planeMesh.position.set(player.x, player.y, player.z);
                    planeMesh.quaternion.set(player.qx, player.qy, player.qz, player.qw);
                    
                    localPlanes[sessionId] = planeMesh;
                    scene.add(planeMesh);

                    player.onChange = () => {
                        planeMesh.position.lerp(new THREE.Vector3(player.x, player.y, player.z), 0.3);
                        planeMesh.quaternion.slerp(new THREE.Quaternion(player.qx, player.qy, player.qz, player.qw), 0.3);
                        
                        if(isMe) {
                            const currentHealth = player.health;
                            const currentStatus = gameStatusRef.current;

                            setPlayerHealth(currentHealth);
                            setScore(player.kills);

                            if (currentHealth <= 0 && currentStatus === 'playing') {
                                setGameStatus('gameover');
                            } else if (currentHealth > 0 && currentStatus === 'gameover') {
                                setGameStatus('playing');
                            }
                        }
                    };
                });
                
                room.state.players.onRemove((player, sessionId) => {
                    if (localPlanes[sessionId]) {
                        scene.remove(localPlanes[sessionId]);
                        delete localPlanes[sessionId];
                    }
                });

                room.state.bullets.onAdd((bullet, bulletId) => {
                    const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                    bulletMesh.position.set(bullet.x, bullet.y, bullet.z);
                    localBullets[bulletId] = bulletMesh;
                    scene.add(bulletMesh);

                    bullet.onChange = () => {
                        bulletMesh.position.set(bullet.x, bullet.y, bullet.z);
                    }
                });
                
                room.state.bullets.onRemove((bullet, bulletId) => {
                    if(localBullets[bulletId]) {
                        scene.remove(localBullets[bulletId]);
                        delete localBullets[bulletId];
                    }
});

                inputInterval = setInterval(() => {
                    if (roomRef.current && gameStatusRef.current === 'playing') {
                        const playerInput = {
                            w: !!keysPressed['w'], s: !!keysPressed['s'], a: !!keysPressed['a'], d: !!keysPressed['d'],
                            shift: !!keysPressed['shift'], space: !!keysPressed[' '], mouse0: !!keysPressed['mouse0'],
                        };
                        roomRef.current.send("input", playerInput);
                    }
                }, 1000 / 20); // 20hz

            }).catch(e => {
                console.error("JOIN ERROR", e);
                router.push('/online');
            }).finally(() => {
                hasActiveJoinRequest = false;
            });
        } else {
            setGameStatus('menu'); 
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('resize', handleResize);
        
        gameLoop(performance.now());
        
        return () => {
            cancelAnimationFrame(animationFrameId);
            if (inputInterval) clearInterval(inputInterval);
            
            roomRef.current?.leave();
            
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            
            Object.values(localPlanes).forEach(plane => scene.remove(plane));
            Object.values(localBullets).forEach(bullet => scene.remove(bullet));
            if(playerPlaneRef.current) scene.remove(playerPlaneRef.current);

            if(mountRef.current && renderer.domElement && mountRef.current.contains(renderer.domElement)) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };
    }, [mode, playerNameProp, router, handlePlayAgain]); // Re-run effect only when mode or player name changes

    return (
        <div className="relative w-screen h-screen bg-background overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
            <div ref={mountRef} className="absolute top-0 left-0 w-full h-full" />
            
            <div 
                className="absolute inset-0 bg-white z-10 pointer-events-none"
                style={{ opacity: whiteoutOpacity, transition: 'opacity 0.5s' }}
            />

            {_gameStatus === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-20">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    <p className="text-xl mt-4 font-headline">{mode === 'online' ? 'Connecting to Arena...' : 'Loading Voxel Skies...'}</p>
                </div>
            )}
            
            {_gameStatus === 'playing' && (
                 <div className="absolute top-4 right-4 z-20">
                    <Button onClick={handleLeaveGame} variant="outline" size="icon" className="h-10 w-10 rounded-full bg-black/30 text-white border-primary/50 backdrop-blur-sm hover:bg-destructive/50">
                        <Home className="h-5 w-5"/>
                        <span className="sr-only">Home</span>
                    </Button>
                </div>
            )}

            {_gameStatus === 'menu' && mode === 'offline' && (
                 <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
                        <CardHeader><CardTitle className="text-5xl font-bold font-headline text-primary">Ready for Takeoff?</CardTitle></CardHeader>
                        <CardContent className="p-8 pt-0">
                            <p className="text-muted-foreground mb-6">Use WASD to steer, Shift for boost, and Left Click or Space to fire. Good luck!</p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={() => setGameStatus('playing')}>Start Flight</Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showAltitudeWarning && _gameStatus === 'playing' && (
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-20 text-center">
                    <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: ALTITUDE CRITICAL</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Descend below {MAX_ALTITUDE}m immediately!</p>
                            <p className="text-5xl font-mono font-bold mt-2">{altitudeWarningTimer.toFixed(1)}</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showBoundaryWarning && _gameStatus === 'playing' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 text-center">
                     <Card className="bg-destructive/80 text-destructive-foreground p-4 border-2 border-destructive-foreground">
                        <CardTitle className="text-3xl font-bold">WARNING: LEAVING BATTLEFIELD</CardTitle>
                        <CardContent className="p-2 pt-2">
                            <p className="text-lg">Return to the combat zone!</p>
                            <p className="text-5xl font-mono font-bold mt-2">{boundaryWarningTimer.toFixed(1)}</p>
                        </CardContent>
                    </Card>
                </div>
            )}
            
            {_gameStatus === 'playing' && roomRef.current && roomRef.current.state.players ? (
                 <HUD score={score} wave={wave} health={playerHealth} overheat={0} altitude={altitude} mode={mode} serverId={roomRef.current.id} players={roomRef.current.state.players} />
            ) : _gameStatus === 'playing' && mode === 'offline' ? (
                 <HUD score={score} wave={wave} health={playerHealth} overheat={0} altitude={altitude} mode={mode} />
            ): null}

            {_gameStatus === 'gameover' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                     <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-destructive/50 shadow-xl text-center">
                        <CardHeader><CardTitle className="text-5xl font-bold font-headline text-destructive">Shot Down!</CardTitle></CardHeader>
                        <CardContent className="p-8 pt-0">
                             <p className="text-foreground mb-6">You were shot down with a final score of <span className="font-bold text-accent">{score}</span> kills.</p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={handlePlayAgain}>Play Again</Button>
                            <Button size="lg" variant="secondary" className="w-full text-lg py-6 mt-2" onClick={handleLeaveGame}>Back to Menu</Button>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
