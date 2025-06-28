
'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Home, Share2 } from 'lucide-react';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from "@/hooks/use-toast";
import * as GameActions from '@/app/game-actions';

// Constants
const MAX_ALTITUDE = 220;
const BOUNDARY = 950;

// Helper function to create plane meshes
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
    
    // This is purely for client-side visuals, not for collision detection
    const hitboxGeo = new THREE.BoxGeometry(9, 3, 5);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.name = 'hitbox';
    plane.add(hitbox);

    return plane;
};

type GameState = 'loading' | 'menu' | 'playing' | 'gameover';
type GameMode = 'offline' | 'online';

interface GameProps {
  mode: GameMode;
  serverId?: string;
  playerName?: string;
}

type LocalBullet = {
    id: string;
    mesh: THREE.Mesh;
    spawnTime: number;
};

type LocalPlane = {
    mesh: THREE.Group;
    name: string;
    isAI: boolean;
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
    const gameInitializedRef = useRef(false);
    const gameStateRef = useRef<GameState>(gameState);
    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    
    // THREE.js & Game Object Refs
    const playerRef = useRef<THREE.Group | null>(null);
    const localPlanesRef = useRef<Record<string, LocalPlane>>({});
    const localBulletsRef = useRef<Record<string, LocalBullet>>({});
    
    const keysPressed = useRef<Record<string, boolean>>({}).current;

    const handleLeaveGame = useCallback(() => { 
      if (mode === 'online' && serverIdProp && playerIdRef.current) {
        GameActions.leaveServer(serverIdProp, playerIdRef.current);
      }
      router.push('/'); 
    }, [router, mode, serverIdProp]);

    const copyInviteLink = () => {
        const inviteLink = `${window.location.origin}/online`;
        navigator.clipboard.writeText(inviteLink);
        toast({
            title: "Copied to clipboard!",
            description: "Invite link copied. Friends can use it to join the game.",
        });
    };

    const handlePlayAgain = useCallback(async () => {
        if (mode === 'online' && serverIdProp && playerNameProp) {
          setGameState('loading');
          const { playerId } = await GameActions.joinServer(serverIdProp, playerNameProp);
          playerIdRef.current = playerId;
          setGameState('playing');
        } else {
            // Offline mode reset
            setScore(0);
            setWave(1);
            setPlayerHealth(100);
            setGunOverheat(0);
            if(playerRef.current) {
              playerRef.current.position.set(0, 50, 0);
              playerRef.current.quaternion.set(0, 0, 0, 1);
            }
            setGameState('playing');
        }
    }, [mode, serverIdProp, playerNameProp]);

    // This effect runs once to set up the entire game
    useEffect(() => {
        if (typeof window === 'undefined' || !mountRef.current || gameInitializedRef.current) return;
        
        gameInitializedRef.current = true;
        const mount = mountRef.current;
        let animationFrameId: number;
        let stateUpdateInterval: NodeJS.Timeout;

        // ---- 1. Synchronous Three.js Setup ----
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB); 
        scene.fog = new THREE.Fog(0x87CEEB, 1000, 2500);
        const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 4000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
        renderer.setPixelRatio(window.devicePixelRatio);
        mount.appendChild(renderer.domElement);
        
        const handleResize = () => {
            if (!mount) return;
            camera.aspect = mount.clientWidth / mount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mount.clientWidth, mount.clientHeight);
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
        let lastTime = 0;

        const gameLoop = (time: number) => {
            animationFrameId = requestAnimationFrame(gameLoop);
            const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
            lastTime = time;

            if (gameStateRef.current === 'playing' && playerRef.current) {
                // In online mode, the server handles physics. Here we just send input.
                if(mode === 'online' && serverIdProp && playerIdRef.current) {
                    const playerInput = {
                        w: !!keysPressed['w'], s: !!keysPressed['s'], a: !!keysPressed['a'], d: !!keysPressed['d'],
                        shift: !!keysPressed['shift'], space: !!keysPressed[' '], mouse0: !!keysPressed['mouse0'],
                    };
                    GameActions.sendInput(serverIdProp, playerIdRef.current, playerInput);

                    if ((playerInput.space || playerInput.mouse0)) {
                         const myPlayerState = localPlanesRef.current[playerIdRef.current];
                         // A bit of client-side prediction for cooldowns
                         if (myPlayerState) {
                             GameActions.fireBullet(serverIdProp, playerIdRef.current, {
                                 position: playerRef.current.position,
                                 quaternion: playerRef.current.quaternion,
                             });
                         }
                    }
                }

                // Handle warnings and camera updates locally
                const currentAltitude = player.position.y - ground.position.y;
                setAltitude(currentAltitude);
                
                if (currentAltitude > MAX_ALTITUDE) {
                    if(gameStateRef.current === 'playing') setShowAltitudeWarning(true);
                    setAltitudeWarningTimer(t => Math.max(0, t - delta));
                    const opacity = Math.max(0, 1 - (altitudeWarningTimer / 5));
                    setWhiteoutOpacity(opacity);
                } else {
                    setShowAltitudeWarning(false);
                    setAltitudeWarningTimer(5);
                    setWhiteoutOpacity(0);
                }
                 if (Math.abs(player.position.x) > BOUNDARY || Math.abs(player.position.z) > BOUNDARY) {
                    if(gameStateRef.current === 'playing') setShowBoundaryWarning(true);
                    setBoundaryWarningTimer(t => Math.max(0, t - delta));
                } else {
                    setShowBoundaryWarning(false);
                    setBoundaryWarningTimer(7);
                }

                const cameraOffset = new THREE.Vector3(0, 8, 15);
                const idealOffset = cameraOffset.clone().applyQuaternion(playerRef.current.quaternion);
                const idealPosition = playerRef.current.position.clone().add(idealOffset);
                camera.position.lerp(idealPosition, 0.1);
                camera.lookAt(playerRef.current.position);
            }
            
            // Client-side visual interpolation for the main player
            if (playerRef.current?.userData?.serverPosition) {
                playerRef.current.position.lerp(playerRef.current.userData.serverPosition, 0.2);
            }
            if (playerRef.current?.userData?.serverQuaternion) {
                playerRef.current.quaternion.slerp(playerRef.current.userData.serverQuaternion, 0.2);
            }

            // Client-side visual interpolation for other players
            Object.values(localPlanesRef.current).forEach(p => {
                if (p.mesh.userData.serverPosition) {
                    p.mesh.position.lerp(p.mesh.userData.serverPosition, 0.2);
                }
                if (p.mesh.userData.serverQuaternion) {
                    p.mesh.quaternion.slerp(p.mesh.userData.serverQuaternion, 0.2);
                }
            });

            // Update local bullets based on their last known position from server
            const now = performance.now();
            for (const bulletId in localBulletsRef.current) {
                const bullet = localBulletsRef.current[bulletId];
                if (now - bullet.spawnTime > 1000) { // Remove after 1 sec if not updated
                    scene.remove(bullet.mesh);
                    delete localBulletsRef.current[bulletId];
                }
            }
            
            renderer.render(scene, camera);
        };
        
        const handleKeyDown = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = false; };
        const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = true; };
        const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = false; };
        
        const setupOnlineGame = async () => {
          if (!serverIdProp || !playerNameProp) {
            router.push('/online');
            return;
          }
          
          try {
            const { playerId, player: initialPlayerState } = await GameActions.joinServer(serverIdProp, playerNameProp);
            playerIdRef.current = playerId;
            
            if (playerRef.current) {
              // initialPlayerState comes from a server action and has serialized THREE.js objects
              playerRef.current.position.fromArray(initialPlayerState.position);
              playerRef.current.quaternion.fromArray(initialPlayerState.quaternion);
            }
            
            setGameState('playing');
            
            stateUpdateInterval = setInterval(async () => {
              if (gameStateRef.current === 'gameover' || !serverIdProp) return;
              
              const state = await GameActions.getFullState(serverIdProp);
              if (!state || !state.players) return;

              const myId = playerIdRef.current;
              const allServerIds = new Set(Object.keys(state.players));

              // Update my player
              const myState = state.players[myId!];
              if (myState) {
                  playerRef.current!.userData.serverPosition = new THREE.Vector3().fromArray(myState.position);
                  playerRef.current!.userData.serverQuaternion = new THREE.Quaternion().fromArray(myState.quaternion);
                  setPlayerHealth(myState.health);
                  setScore(myState.kills);

                  if (myState.health <= 0 && gameStateRef.current !== 'gameover') {
                      setGameState('gameover');
                  }
              } else if (gameStateRef.current === 'playing' && myId) {
                  // I've been removed from the server state (e.g., timed out)
                  setGameState('gameover');
              }

              // Update other players
              for (const pId in state.players) {
                  if (pId === myId) continue;
                  
                  const pState = state.players[pId];
                  let localPlane = localPlanesRef.current[pId];
                  
                  if (!localPlane) {
                      const color = pState.isAI ? 0xff0000 : 0xffaa00; // AI red, other players orange
                      const newPlaneMesh = createVoxelPlane(color);
                      scene.add(newPlaneMesh);
                      localPlanesRef.current[pId] = { mesh: newPlaneMesh, name: pState.name, isAI: pState.isAI };
                      localPlane = localPlanesRef.current[pId];
                  }

                  localPlane.mesh.userData.serverPosition = new THREE.Vector3().fromArray(pState.position);
                  localPlane.mesh.userData.serverQuaternion = new THREE.Quaternion().fromArray(pState.quaternion);
              }
              
              // Remove stale local players
              for (const localId in localPlanesRef.current) {
                  if (!allServerIds.has(localId)) {
                      scene.remove(localPlanesRef.current[localId].mesh);
                      delete localPlanesRef.current[localId];
                  }
              }

              // Update bullets
              const allBulletIds = new Set(Object.keys(state.bullets));
              for(const bId in state.bullets) {
                  const bState = state.bullets[bId];
                  if(!localBulletsRef.current[bId]) {
                      const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                      const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                      const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
                      bulletMesh.position.fromArray(bState.position);
                      scene.add(bulletMesh);
                      localBulletsRef.current[bId] = { id: bId, mesh: bulletMesh, spawnTime: performance.now() };
                  } else {
                      localBulletsRef.current[bId].mesh.position.fromArray(bState.position);
                      localBulletsRef.current[bId].spawnTime = performance.now();
                  }
              }
              // Remove stale bullets
              for (const localBId in localBulletsRef.current) {
                  if (!allBulletIds.has(localBId)) {
                      scene.remove(localBulletsRef.current[localBId].mesh);
                      delete localBulletsRef.current[localBId];
                  }
              }

            }, 100); // 10hz state sync

          } catch (error) {
            console.error("Failed to join game:", error);
            toast({ title: "Error Joining Server", description: "Could not join the game server.", variant: "destructive" });
            router.push('/online');
          }
        };

        const setupOfflineGame = () => {
            playerIdRef.current = 'offline_player';
            setGameState('menu');
        };

        if (mode === 'online') {
            setupOnlineGame();
        } else {
            setupOfflineGame();
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        
        gameLoop(performance.now());
        
        return () => {
            cancelAnimationFrame(animationFrameId);
            clearInterval(stateUpdateInterval);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            
            const pid = playerIdRef.current;
            if (mode === 'online' && serverIdProp && pid) {
                GameActions.leaveServer(serverIdProp, pid);
            }
            if(mountRef.current && renderer.domElement) {
                mountRef.current.removeChild(renderer.domElement);
            }
        };
    }, []); // This effect should run only once.

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
                                <p className="text-foreground mb-6">You were shot down with a final score of <span className="font-bold text-accent">{score}</span> kills.</p>
                             }
                            <Button size="lg" className="w-full text-lg py-6" onClick={handlePlayAgain}>Play Again</Button>
                             {mode === 'online' && (
                                <Button size="lg" variant="secondary" className="w-full text-lg py-6 mt-2" onClick={handleLeaveGame}>Back to Menu</Button>
                            )}
                             {mode === 'offline' && (
                                <Button size="lg" variant="secondary" className="w-full text-lg py-6 mt-2" onClick={() => setGameState('menu')}>Back to Menu</Button>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}

    

    
