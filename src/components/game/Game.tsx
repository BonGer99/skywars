
'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useCallback } from 'react';
import { generateOpponentBehavior, OpponentBehaviorOutput } from '@/ai/flows/ai-opponent-behavior';
import HUD from '@/components/ui/HUD';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type GameState = 'loading' | 'menu' | 'playing' | 'gameover';

class Particle {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    lifespan: number;

    constructor(scene: THREE.Scene, position: THREE.Vector3, color: THREE.ColorRepresentation, velocity: THREE.Vector3) {
        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const material = new THREE.MeshBasicMaterial({ color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.velocity = velocity;
        this.lifespan = Math.random() * 15 + 8;
        scene.add(this.mesh);
    }

    update(delta: number) {
        this.lifespan -= delta * 60; // Assumes 60fps for lifespan calculation
        this.mesh.position.add(this.velocity.clone().multiplyScalar(delta));
        this.velocity.multiplyScalar(0.98);
    }
}

export default function Game() {
    const mountRef = useRef<HTMLDivElement>(null);
    const gameLoopId = useRef<number>();
    const lastTimeRef = useRef<number>(0);

    const [gameState, setGameState] = useState<GameState>('loading');
    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(0);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [gunOverheat, setGunOverheat] = useState(0);
    const [altitude, setAltitude] = useState(0);
    const { toast } = useToast();

    const gameData = useRef({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(75, 1, 0.1, 4000),
        renderer: null as THREE.WebGLRenderer | null,
        player: null as THREE.Group | null,
        enemies: [] as { mesh: THREE.Group, health: number, behavior: OpponentBehaviorOutput, timeSinceShot: number }[],
        bullets: [] as { mesh: THREE.Mesh, velocity: THREE.Vector3, isPlayerBullet: boolean }[],
        particles: [] as Particle[],
        keysPressed: {} as Record<string, boolean>,
        gunCooldown: 0,
    });
    
    const spawnWave = useCallback(async (waveNumber: number) => {
        // AI is disabled for now
        return;
    }, []);

    const createVoxelPlane = (color: THREE.Color) => {
        const plane = new THREE.Group();
        const bodyMat = new THREE.MeshBasicMaterial({ color });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 4), bodyMat);
        plane.add(body);
        const wings = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 1.5), bodyMat);
        wings.position.y = 0.2;
        plane.add(wings);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1), bodyMat);
        tail.position.set(0, 0.2, -2.5);
        plane.add(tail);
        return plane;
    };

    const createExplosion = (position: THREE.Vector3) => {
        for (let i = 0; i < 20; i++) {
            const velocity = new THREE.Vector3((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15);
            const color = Math.random() > 0.5 ? 0xffa500 : 0xff4500;
            gameData.current.particles.push(new Particle(gameData.current.scene, position, color, velocity));
        }
    };

    const gameLoop = useCallback((time: number) => {
        gameLoopId.current = requestAnimationFrame(gameLoop);
        
        if (!gameData.current.renderer) return;

        // Ensure delta is not NaN on first frame
        if (lastTimeRef.current === 0) {
            lastTimeRef.current = time;
        }
        const delta = (time - lastTimeRef.current) * 0.001;
        lastTimeRef.current = time;

        const { player, camera, keysPressed, scene, renderer } = gameData.current;

        if (gameState === 'playing' && player) {
            const PITCH_SPEED = 1.0;
            const ROLL_SPEED = 1.5;
            const BASE_SPEED = 20;
            const BOOST_SPEED = 40;

            if (keysPressed['w'] || keysPressed['W']) player.rotateX(PITCH_SPEED * delta);
            if (keysPressed['s'] || keysPressed['S']) player.rotateX(-PITCH_SPEED * delta);
            if (keysPressed['a'] || keysPressed['A']) player.rotateZ(ROLL_SPEED * delta);
            if (keysPressed['d'] || keysPressed['D']) player.rotateZ(-ROLL_SPEED * delta);

            let currentSpeed = BASE_SPEED;
            if (keysPressed['shift']) {
                currentSpeed += BOOST_SPEED;
            }

            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
            player.position.add(forward.clone().multiplyScalar(currentSpeed * delta));

            const groundLevel = -50;
            const currentAltitude = player.position.y - groundLevel;
            setAltitude(Math.max(0, currentAltitude));

            if (player.position.y <= groundLevel) {
                createExplosion(player.position);
                setGameState('gameover');
                player.position.y = groundLevel;
            }

            gameData.current.gunCooldown = Math.max(0, gameData.current.gunCooldown - delta);
            if (gunOverheat > 0) setGunOverheat(o => Math.max(0, o - 15 * delta));

            if ((keysPressed['mouse0'] || keysPressed[' ']) && gameData.current.gunCooldown <= 0 && gunOverheat < 100) {
                const bulletOffset = new THREE.Vector3(0, 0, 2).applyQuaternion(player.quaternion);
                const bulletPos = player.position.clone().add(bulletOffset);
                const bulletVel = forward.clone().multiplyScalar(200).add(player.position);
                
                const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                const bullet = new THREE.Mesh(bulletGeo, bulletMat);
                bullet.position.copy(bulletPos);
                bullet.quaternion.copy(player.quaternion);
                
                // We set the bullet's velocity relative to the world, not just the direction
                const bulletWorldVelocity = new THREE.Vector3(0, 0, 200).applyQuaternion(player.quaternion);
                gameData.current.bullets.push({ mesh: bullet, velocity: bulletWorldVelocity, isPlayerBullet: true });
                scene.add(bullet);

                gameData.current.gunCooldown = 0.1;
                setGunOverheat(o => o + 5);
            }

            gameData.current.bullets.forEach((bullet, index) => {
                bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));
                if (bullet.mesh.position.length() > 2000) {
                    scene.remove(bullet.mesh);
                    gameData.current.bullets.splice(index, 1);
                }
            });

            gameData.current.particles.forEach((p, i) => {
                p.update(delta);
                if (p.lifespan <= 0) {
                    scene.remove(p.mesh);
                    gameData.current.particles.splice(i, 1);
                }
            });
            
            if (playerHealth <= 0) {
                createExplosion(player.position);
                setGameState('gameover');
            }
        }
        
        renderer.render(scene, camera);
    }, [gameState, playerHealth, gunOverheat]);
    
    const startGame = useCallback(() => {
        setGameState('playing');
        setScore(0);
        setPlayerHealth(100);
        setGunOverheat(0);
        setWave(0);
        
        if (gameData.current.player) {
            gameData.current.player.position.set(0, 5, 0);
            gameData.current.player.rotation.set(0, 0, 0);
        }
        
        gameData.current.bullets.forEach(b => gameData.current.scene.remove(b.mesh));
        gameData.current.bullets = [];

        spawnWave(1);
    }, [spawnWave]);

    useEffect(() => {
        if (!mountRef.current || gameData.current.renderer) return;

        const { scene, camera } = gameData.current;
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
        renderer.setPixelRatio(1);
        renderer.setSize(window.innerWidth, window.innerHeight);
        mountRef.current.appendChild(renderer.domElement);
        gameData.current.renderer = renderer;

        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();

        scene.background = new THREE.Color(0x58ACFA);

        const groundGeo = new THREE.PlaneGeometry(4000, 4000);
        const groundMat = new THREE.MeshBasicMaterial({ color: 0x3d85c6 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -50;
        scene.add(ground);

        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for(let i = 0; i < 20; i++) {
            const cloud = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 8), cloudMat);
            cloud.position.set((Math.random() - 0.5) * 4000, Math.random() * 150 + 50, (Math.random() - 0.5) * 4000);
            scene.add(cloud);
        }
        
        const player = createVoxelPlane(new THREE.Color(0x0077ff));
        scene.add(player);
        gameData.current.player = player;

        // Attach camera to the player for a stable follow-cam
        const cameraOffset = new THREE.Vector3(0, 6, -15);
        player.add(camera);
        camera.position.copy(cameraOffset);
        camera.lookAt(player.position.clone().add(new THREE.Vector3(0,0,10)));

        const handleKeyDown = (e: KeyboardEvent) => { gameData.current.keysPressed[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e: KeyboardEvent) => { gameData.current.keysPressed[e.key.toLowerCase()] = false; };
        const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) gameData.current.keysPressed['mouse0'] = true; };
        const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) gameData.current.keysPressed['mouse0'] = false; };
        
        const handleResize = () => {
            if (renderer) {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('resize', handleResize);
        
        lastTimeRef.current = performance.now();
        gameLoopId.current = requestAnimationFrame(gameLoop);
        
        setGameState('menu');

        return () => {
            if (gameLoopId.current) {
                cancelAnimationFrame(gameLoopId.current);
            }
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
            if(mountRef.current && renderer) {
                mountRef.current.removeChild(renderer.domElement);
                renderer.dispose();
            }
            gameData.current.renderer = null;
        };
    }, [gameLoop]);

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
                        <CardHeader>
                            <CardTitle className="text-5xl font-bold font-headline text-primary">Ready for Takeoff?</CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 pt-0">
                            <p className="text-muted-foreground mb-6">Use WASD to steer, Shift to accelerate, and Left Click or Space to fire. Good luck!</p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={startGame}>
                                Start Flight
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {gameState === 'playing' && (
                <HUD score={score} wave={wave} health={playerHealth} overheat={gunOverheat} altitude={altitude} />
            )}

            {gameState === 'gameover' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                     <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-destructive/50 shadow-xl text-center">
                        <CardHeader>
                            <CardTitle className="text-5xl font-bold font-headline text-destructive">Game Over</CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 pt-0">
                            <p className="text-foreground mb-2">You survived to <span className="font-bold text-accent">Wave {wave}</span></p>
                            <p className="text-foreground mb-6">Final Score: <span className="font-bold text-accent">{score}</span></p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={startGame}>
                                Play Again
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
