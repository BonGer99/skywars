
'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useCallback } from 'react';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

type GameState = 'loading' | 'menu' | 'playing' | 'gameover';

export default function Game() {
    const mountRef = useRef<HTMLDivElement>(null);

    const [gameState, setGameState] = useState<GameState>('loading');
    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(0);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [gunOverheat, setGunOverheat] = useState(0);
    const [altitude, setAltitude] = useState(0);
    
    const gameStateRef = useRef(gameState);
    useEffect(() => {
      gameStateRef.current = gameState;
    }, [gameState]);

    const startGame = useCallback(() => {
        setGameState('playing');
    }, []);

    useEffect(() => {
        if (!mountRef.current) return;
        
        const mount = mountRef.current;
        let animationFrameId: number;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB); 

        const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 4000);
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
        
        renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1.5 : 1);
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        mount.appendChild(renderer.domElement);

        const createVoxelPlane = (color: THREE.Color) => {
            const plane = new THREE.Group();
            const bodyMat = new THREE.MeshLambertMaterial({ color });
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 4), bodyMat);
            plane.add(body);
            const wings = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 1.5), bodyMat);
            wings.position.y = 0.2;
            plane.add(wings);
            const tail = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1), bodyMat);
            tail.position.set(0, 0.2, -2.5);
            plane.add(tail);
            const cockpitGeo = new THREE.BoxGeometry(0.8, 0.6, 1);
            const cockpitMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
            const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
            cockpit.position.set(0, 0.8, -0.5);
            plane.add(cockpit);
            return plane;
        };
        
        const player = createVoxelPlane(new THREE.Color(0x0077ff));
        scene.add(player);

        const cameraOffset = new THREE.Vector3(0, 5, 12);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 10, 7.5);
        scene.add(directionalLight);

        const groundGeo = new THREE.PlaneGeometry(4000, 4000);
        const groundMat = new THREE.MeshLambertMaterial({ color: 0x3d85c6 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -50;
        scene.add(ground);

        for(let i = 0; i < 20; i++) {
            const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const cloud = new THREE.Mesh(new THREE.BoxGeometry(30, 10, 10), cloudMat);
            cloud.position.set((Math.random() - 0.5) * 4000, Math.random() * 200 + 80, (Math.random() - 0.5) * 4000);
            scene.add(cloud);
        }

        const keysPressed: Record<string, boolean> = {};
        const bullets: { mesh: THREE.Mesh, velocity: THREE.Vector3 }[] = [];
        let gunCooldown = 0;
        
        let lastGameState = gameStateRef.current;
        
        const resetGame = () => {
            player.position.set(0, 20, 0);
            player.rotation.set(0, 0, 0);
            player.quaternion.set(0, 0, 0, 1);
            bullets.forEach(b => scene.remove(b.mesh));
            bullets.length = 0;
            setPlayerHealth(100);
            setGunOverheat(0);
            setScore(0);
            setWave(1);
            setAltitude(player.position.y - ground.position.y);
        };
        
        let lastTime = 0;
        const gameLoop = (time: number) => {
            animationFrameId = requestAnimationFrame(gameLoop);
            
            const delta = lastTime > 0 ? (time - lastTime) / 1000 : 1/60;
            lastTime = time;

            if (gameStateRef.current === 'playing' && lastGameState !== 'playing') {
                resetGame();
            }
            lastGameState = gameStateRef.current;
            
            if (gameStateRef.current === 'playing') {
                const PITCH_SPEED = 1.2;
                const ROLL_SPEED = 1.8;
                const BASE_SPEED = 30;
                const BOOST_MULTIPLIER = 2.0;

                if (keysPressed['w'] || keysPressed['W']) player.rotateX(-PITCH_SPEED * delta);
                if (keysPressed['s'] || keysPressed['S']) player.rotateX(PITCH_SPEED * delta);
                if (keysPressed['a'] || keysPressed['A']) player.rotateZ(ROLL_SPEED * delta);
                if (keysPressed['d'] || keysPressed['D']) player.rotateZ(-ROLL_SPEED * delta);

                let currentSpeed = BASE_SPEED;
                if (keysPressed['shift']) {
                    currentSpeed *= BOOST_MULTIPLIER;
                }
                
                const forward = new THREE.Vector3(0, 0, -1);
                forward.applyQuaternion(player.quaternion);
                player.position.add(forward.multiplyScalar(currentSpeed * delta));

                const groundLevel = ground.position.y;
                setAltitude(player.position.y - groundLevel);

                if (player.position.y <= groundLevel) {
                    setPlayerHealth(h => {
                        if (h > 0) {
                           setGameState('gameover');
                        }
                        return 0;
                    });
                }

                gunCooldown = Math.max(0, gunCooldown - delta);
                setGunOverheat(o => Math.max(0, o - 15 * delta));
                
                if ((keysPressed['mouse0'] || keysPressed[' ']) && gunCooldown <= 0) {
                    setGunOverheat(o => {
                        if (o < 100) {
                            gunCooldown = 0.1;
                            const bulletOffset = new THREE.Vector3(0, 0, -2).applyQuaternion(player.quaternion);
                            const bulletPos = player.position.clone().add(bulletOffset);
                            const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                            const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                            const bullet = new THREE.Mesh(bulletGeo, bulletMat);
                            bullet.position.copy(bulletPos);
                            bullet.quaternion.copy(player.quaternion);
                            const bulletWorldVelocity = new THREE.Vector3(0, 0, -200).applyQuaternion(player.quaternion);
                            bullets.push({ mesh: bullet, velocity: bulletWorldVelocity });
                            scene.add(bullet);
                            return o + 5;
                        }
                        return o;
                    });
                }
            }

            bullets.forEach((b, i) => {
                b.mesh.position.add(b.velocity.clone().multiplyScalar(delta));
                if (b.mesh.position.distanceTo(player.position) > 2000) {
                    scene.remove(b.mesh);
                    bullets.splice(i, 1);
                }
            });

            const idealOffset = cameraOffset.clone();
            idealOffset.applyQuaternion(player.quaternion);
            const idealPosition = player.position.clone().add(idealOffset);
            
            camera.position.lerp(idealPosition, 0.1);
            camera.lookAt(player.position);

            renderer.render(scene, camera);
        };
        
        const handleKeyDown = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e: KeyboardEvent) => { keysPressed[e.key.toLowerCase()] = false; };
        const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = true; };
        const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) keysPressed['mouse0'] = false; };
        
        const handleResize = () => {
            if (!mount) return;
            camera.aspect = mount.clientWidth / mount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('resize', handleResize);
        
        setGameState('menu');
        gameLoop(performance.now());

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            if(mountRef.current) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
            scene.traverse(child => {
                if (child instanceof THREE.Mesh) {
                    child.geometry.dispose();
                    if(child.material instanceof THREE.Material || Array.isArray(child.material)) {
                        (Array.isArray(child.material) ? child.material : [child.material]).forEach(mat => mat.dispose());
                    }
                }
            });
        };
    }, []);

    return (
        <div className="relative w-screen h-screen bg-background overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
            <div ref={mountRef} className="absolute top-0 left-0 w-full h-full" />
            
            {gameState === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-20">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    <p className="text-xl mt-4 font-headline">Loading Voxel Skies...</p>
                </div>
            )}

            {gameState === 'menu' && (
                 <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
                        <CardHeader><CardTitle className="text-5xl font-bold font-headline text-primary">Ready for Takeoff?</CardTitle></CardHeader>
                        <CardContent className="p-8 pt-0">
                            <p className="text-muted-foreground mb-6">Use WASD to steer, Shift for boost, and Left Click or Space to fire. Good luck!</p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={startGame}>Start Flight</Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {gameState === 'playing' && <HUD score={score} wave={wave} health={playerHealth} overheat={gunOverheat} altitude={altitude} />}

            {gameState === 'gameover' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                     <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-destructive/50 shadow-xl text-center">
                        <CardHeader><CardTitle className="text-5xl font-bold font-headline text-destructive">Game Over</CardTitle></CardHeader>
                        <CardContent className="p-8 pt-0">
                            <p className="text-foreground mb-2">You survived to <span className="font-bold text-accent">Wave {wave}</span></p>
                            <p className="text-foreground mb-6">Final Score: <span className="font-bold text-accent">{score}</span></p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={startGame}>Play Again</Button>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
