'use client';

import * as THREE from 'three';
import * as Tone from 'tone';
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
        this.lifespan = Math.random() * 60 + 30; // 0.5 to 1.5 seconds
        scene.add(this.mesh);
    }

    update() {
        this.lifespan--;
        this.mesh.position.add(this.velocity);
        this.velocity.multiplyScalar(0.98); // friction
        this.mesh.material.opacity = this.lifespan / 60;
        if (this.mesh.material.opacity < 0) this.mesh.material.opacity = 0;
    }
}

export default function Game() {
    const mountRef = useRef<HTMLDivElement>(null);
    const [gameState, setGameState] = useState<GameState>('loading');
    const [score, setScore] = useState(0);
    const [wave, setWave] = useState(0);
    const [playerHealth, setPlayerHealth] = useState(100);
    const [gunOverheat, setGunOverheat] = useState(0);
    const { toast } = useToast();

    const gameData = useRef({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000),
        renderer: null as THREE.WebGLRenderer | null,
        player: null as THREE.Group | null,
        enemies: [] as { mesh: THREE.Group, health: number, behavior: OpponentBehaviorOutput, timeSinceShot: number }[],
        bullets: [] as { mesh: THREE.Mesh, velocity: THREE.Vector3, isPlayerBullet: boolean }[],
        particles: [] as Particle[],
        keysPressed: {} as Record<string, boolean>,
        mousePosition: new THREE.Vector2(),
        playerVelocity: new THREE.Vector3(),
        gunCooldown: 0,
        time: new THREE.Clock(),
        sounds: {
            shoot: null as Tone.Synth | null,
            explosion: null as Tone.NoiseSynth | null,
        }
    });

    const spawnWave = useCallback(async (waveNumber: number) => {
        setWave(waveNumber);
        const numEnemies = 2 + Math.floor(waveNumber / 2);
        
        try {
            const behavior = await generateOpponentBehavior({ waveNumber, playerSkillLevel: 'intermediate' });

            for (let i = 0; i < numEnemies; i++) {
                const enemy = createVoxelPlane(new THREE.Color(0xff6347));
                enemy.position.set(
                    (Math.random() - 0.5) * 100,
                    (Math.random() * 20) + 10,
                    -100 - (Math.random() * 50)
                );
                gameData.current.scene.add(enemy);
                gameData.current.enemies.push({ mesh: enemy, health: 100, behavior, timeSinceShot: 0 });
            }
        } catch (error) {
            console.error("Failed to generate AI behavior:", error);
            toast({
                title: "AI Error",
                description: "Could not generate enemy behavior. Please try again.",
                variant: "destructive"
            });
        }
    }, [toast]);
    
    const startGame = useCallback(() => {
        setGameState('playing');
        setScore(0);
        setPlayerHealth(100);
        setGunOverheat(0);
        setWave(0);
        
        // Reset player
        if (gameData.current.player) {
            gameData.current.player.position.set(0, 5, 0);
            gameData.current.player.rotation.set(0, 0, 0);
            gameData.current.playerVelocity.set(0, 0, 0);
            
            const { camera, player } = gameData.current;
            const idealOffset = new THREE.Vector3(0, 4, -10);
            idealOffset.add(player.position);
            camera.position.copy(idealOffset);
            camera.lookAt(player.position);
        }
        
        // Clear old game objects
        gameData.current.enemies.forEach(e => gameData.current.scene.remove(e.mesh));
        gameData.current.enemies = [];
        gameData.current.bullets.forEach(b => gameData.current.scene.remove(b.mesh));
        gameData.current.bullets = [];
        
        spawnWave(1);
    }, [spawnWave]);

    const createVoxelPlane = (color: THREE.Color) => {
        const plane = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color });
        const wingMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xcccccc) });
        const propMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 4), bodyMat);
        plane.add(body);
        const topWing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 1.5), wingMat);
        topWing.position.y = 0.8;
        plane.add(topWing);
        const bottomWing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 1.2), wingMat);
        bottomWing.position.y = -0.3;
        plane.add(bottomWing);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1), wingMat);
        tail.position.set(0, 0.2, -2.5);
        plane.add(tail);
        const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 1), wingMat);
        rudder.position.set(0, 0.8, -2.5);
        plane.add(rudder);
        const prop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2), propMat);
        prop.position.z = 2.2;
        plane.add(prop);
        (plane as any).prop = prop;

        return plane;
    };

    const gameLoop = useCallback(() => {
        if (gameState !== 'playing') return;

        const delta = gameData.current.time.getDelta();
        const { player, camera, keysPressed, playerVelocity } = gameData.current;

        if (!player) return;

        // Player controls
        const throttle = 0.7; // Constant throttle
        const moveSpeed = 50 * throttle;
        const PITCH_SPEED = 1.0;
        const ROLL_SPEED = 1.5;

        if (keysPressed['w'] || keysPressed['W']) player.rotateX(PITCH_SPEED * delta);
        if (keysPressed['s'] || keysPressed['S']) player.rotateX(-PITCH_SPEED * delta);
        if (keysPressed['a'] || keysPressed['A']) player.rotateZ(ROLL_SPEED * delta);
        if (keysPressed['d'] || keysPressed['D']) player.rotateZ(-ROLL_SPEED * delta);

        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
        playerVelocity.add(forward.multiplyScalar(delta * moveSpeed));
        playerVelocity.multiplyScalar(0.98); // Drag
        player.position.add(playerVelocity.clone().multiplyScalar(delta));
        (player as any).prop.rotation.z += delta * 20 * throttle;

        // Camera follow
        const idealOffset = new THREE.Vector3(0, 4, -10);
        idealOffset.applyQuaternion(player.quaternion);
        idealOffset.add(player.position);
        camera.position.lerp(idealOffset, delta * 5);
        camera.lookAt(player.position);

        // Gun logic
        gameData.current.gunCooldown = Math.max(0, gameData.current.gunCooldown - delta);
        if (gunOverheat > 0) setGunOverheat(o => Math.max(0, o - delta * 15));
        
        if ((keysPressed['mouse0'] || keysPressed[' ']) && gameData.current.gunCooldown <= 0 && gunOverheat < 100) {
            gameData.current.sounds.shoot?.triggerAttackRelease("C4", "8n");
            
            const bulletPos = player.position.clone().add(new THREE.Vector3(0, 0, 2).applyQuaternion(player.quaternion));
            const bulletVel = new THREE.Vector3(0, 0, 200).applyQuaternion(player.quaternion);
            
            const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
            const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
            const bullet = new THREE.Mesh(bulletGeo, bulletMat);
            bullet.position.copy(bulletPos);
            gameData.current.scene.add(bullet);
            gameData.current.bullets.push({ mesh: bullet, velocity: bulletVel, isPlayerBullet: true });
            
            gameData.current.gunCooldown = 0.1;
            setGunOverheat(o => o + 5);
        }

        // Bullets update
        gameData.current.bullets.forEach((bullet, index) => {
            bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));
            if (bullet.mesh.position.length() > 1000) {
                gameData.current.scene.remove(bullet.mesh);
                gameData.current.bullets.splice(index, 1);
            }
        });
        
        // Enemies update
        gameData.current.enemies.forEach((enemy, enemyIndex) => {
            const enemyToPlayer = player.position.clone().sub(enemy.mesh.position);
            const distance = enemyToPlayer.length();
            
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.mesh.quaternion);
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), enemyToPlayer.normalize());
            enemy.mesh.quaternion.slerp(targetQuaternion, delta * 1.0);
            
            const enemySpeed = 20 + wave * 2;
            enemy.mesh.position.add(forward.multiplyScalar(enemySpeed * delta));
            (enemy.mesh as any).prop.rotation.z += delta * 15;

            enemy.timeSinceShot += delta;
            if (distance < 200 && enemy.timeSinceShot > 2) {
                const bulletPos = enemy.mesh.position.clone().add(new THREE.Vector3(0,0,2).applyQuaternion(enemy.mesh.quaternion));
                const bulletVel = new THREE.Vector3(0, 0, 100).applyQuaternion(enemy.mesh.quaternion);
                
                const bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 1);
                const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                const bullet = new THREE.Mesh(bulletGeo, bulletMat);
                bullet.position.copy(bulletPos);
                gameData.current.scene.add(bullet);
                gameData.current.bullets.push({ mesh: bullet, velocity: bulletVel, isPlayerBullet: false });
                enemy.timeSinceShot = 0;
            }

            // Collision check: player bullets vs enemies
            const enemyBox = new THREE.Box3().setFromObject(enemy.mesh);
            gameData.current.bullets.forEach((bullet, bulletIndex) => {
                if(bullet.isPlayerBullet) {
                    const bulletBox = new THREE.Box3().setFromObject(bullet.mesh);
                    if (enemyBox.intersectsBox(bulletBox)) {
                        gameData.current.scene.remove(bullet.mesh);
                        gameData.current.bullets.splice(bulletIndex, 1);
                        enemy.health -= 10;
                        if(enemy.health <= 0) {
                            createExplosion(enemy.mesh.position);
                            gameData.current.scene.remove(enemy.mesh);
                            gameData.current.enemies.splice(enemyIndex, 1);
                            setScore(s => s + 100);
                        }
                    }
                }
            });
        });

        // Collision check: enemy bullets vs player
        const playerBox = new THREE.Box3().setFromObject(player);
        gameData.current.bullets.forEach((bullet, bulletIndex) => {
             if(!bullet.isPlayerBullet) {
                const bulletBox = new THREE.Box3().setFromObject(bullet.mesh);
                if (playerBox.intersectsBox(bulletBox)) {
                    gameData.current.scene.remove(bullet.mesh);
                    gameData.current.bullets.splice(bulletIndex, 1);
                    setPlayerHealth(h => h - 5);
                }
            }
        });

        // Particle update
        gameData.current.particles.forEach((p, i) => {
            p.update();
            if (p.lifespan <= 0) {
                gameData.current.scene.remove(p.mesh);
                gameData.current.particles.splice(i, 1);
            }
        });

        if (playerHealth <= 0) {
            createExplosion(player.position);
            setGameState('gameover');
        }
        
        if(gameData.current.enemies.length === 0 && gameState === 'playing') {
            spawnWave(wave + 1);
        }

        gameData.current.renderer?.render(gameData.current.scene, camera);
        requestAnimationFrame(gameLoop);
    }, [gameState, playerHealth, gunOverheat, spawnWave, wave]);

    const createExplosion = (position: THREE.Vector3) => {
        gameData.current.sounds.explosion?.triggerAttackRelease("2n");
        for (let i = 0; i < 50; i++) {
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            const color = Math.random() > 0.5 ? 0xffa500 : 0xff4500;
            gameData.current.particles.push(new Particle(gameData.current.scene, position, color, velocity));
        }
    };

    useEffect(() => {
        if (!mountRef.current || gameData.current.renderer) return;

        const { scene, camera } = gameData.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        mountRef.current.appendChild(renderer.domElement);
        gameData.current.renderer = renderer;

        scene.background = new THREE.Color(0x58ACFA);
        scene.fog = new THREE.Fog(0x58ACFA, 100, 1000);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(100, 100, 50);
        scene.add(directionalLight);

        // Ground
        const groundGeo = new THREE.PlaneGeometry(2000, 2000);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d85c6 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -50;
        scene.add(ground);

        // World (Clouds and Islands)
        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.9, transparent: true });
        for(let i = 0; i < 50; i++) {
            const cloud = new THREE.Group();
            for(let j=0; j<5; j++) {
                const part = new THREE.Mesh(new THREE.BoxGeometry(10,5,5), cloudMat);
                part.position.set( (Math.random()-0.5)*15, (Math.random()-0.5)*5, (Math.random()-0.5)*15);
                cloud.add(part);
            }
            cloud.position.set((Math.random() - 0.5) * 1500, Math.random() * 50 + 20, (Math.random() - 0.5) * 1500);
            scene.add(cloud);
        }
        
        const islandMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
         for(let i = 0; i < 15; i++) {
            const island = new THREE.Mesh(new THREE.BoxGeometry(50, 20, 50), islandMat);
            island.position.set((Math.random() - 0.5) * 1500, Math.random() * 20 - 10, (Math.random() - 0.5) * 1500);
            scene.add(island);
        }

        // Player
        const player = createVoxelPlane(new THREE.Color(0x0077ff));
        player.position.set(0, 5, 0);
        scene.add(player);
        gameData.current.player = player;

        // Sounds
        gameData.current.sounds.shoot = new Tone.Synth().toDestination();
        gameData.current.sounds.explosion = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0 }
        }).toDestination();
        
        const handleKeyDown = (e: KeyboardEvent) => { gameData.current.keysPressed[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e: KeyboardEvent) => { gameData.current.keysPressed[e.key.toLowerCase()] = false; };
        const handleMouseDown = (e: MouseEvent) => { if(e.button === 0) gameData.current.keysPressed['mouse0'] = true; };
        const handleMouseUp = (e: MouseEvent) => { if(e.button === 0) gameData.current.keysPressed['mouse0'] = false; };
        const handleMouseMove = (e: MouseEvent) => {
            gameData.current.mousePosition.x = (e.clientX / window.innerWidth) * 2 - 1;
            gameData.current.mousePosition.y = -(e.clientY / window.innerHeight) * 2 + 1;
        };
        const handleResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('resize', handleResize);
        
        setGameState('menu');

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('resize', handleResize);
            mountRef.current?.removeChild(renderer.domElement);
            gameData.current.renderer = null;
        };
    }, []);

    useEffect(() => {
        if (gameState === 'playing') {
            requestAnimationFrame(gameLoop);
        }
    }, [gameState, gameLoop]);

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
                            <p className="text-muted-foreground mb-6">Use your WASD keys to steer, and Left Click or Space to fire. Survive the incoming waves!</p>
                            <Button size="lg" className="w-full text-lg py-6" onClick={startGame}>
                                Start Survival Mode
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {gameState === 'playing' && (
                <HUD score={score} wave={wave} health={playerHealth} overheat={gunOverheat} />
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
