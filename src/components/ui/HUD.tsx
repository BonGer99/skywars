import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { MapSchema } from '@colyseus/schema';
import type { Player } from '@/server/rooms/state/VoxelAcesState';
import { Plus, Flame, ArrowUp, Star, Users, Home, Settings } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';

interface HUDProps {
  score: number;
  wave: number;
  health: number;
  overheat: number;
  altitude: number;
  mode: 'offline' | 'online';
  players?: MapSchema<Player>;
  onLeaveGame: () => void;
}

export default function HUD({ score, wave, health, overheat, altitude, mode, players, onLeaveGame }: HUDProps) {
  return (
    <div className="absolute top-0 left-0 right-0 p-2 text-white font-headline pointer-events-none select-none bg-black/20 backdrop-blur-sm z-10">
      <div className="flex justify-between items-start">
        {/* Left Stats */}
        <div className="flex items-center gap-x-4 text-lg">
          <div className="flex items-center gap-1.5" title="Health">
            <Plus className="h-5 w-5 text-green-400" />
            <Progress value={health} className="w-20 h-2.5" indicatorClassName="bg-green-400" />
          </div>
          <div className="flex items-center gap-1.5" title="Gun Overheat">
            <Flame className="h-5 w-5 text-orange-400" />
            <Progress value={overheat} className="w-20 h-2.5" indicatorClassName="bg-orange-400" />
          </div>
          <div className="flex items-center gap-1.5" title="Altitude">
            <ArrowUp className="h-5 w-5" />
            <span>{Math.round(altitude)}m</span>
          </div>
        </div>

        {/* Right Stats & Actions */}
        <div className="flex flex-col items-end gap-y-2">
            <div className="flex items-center gap-x-4 text-lg">
                <div className="flex items-center gap-1.5" title="Kills">
                  <Star className="h-5 w-5 text-yellow-400" />
                  <span>{score}</span>
                </div>
                {mode === 'online' ? (
                    <div className="flex items-center gap-1.5" title="Players">
                        <Users className="h-5 w-5" />
                        <span>{players?.size || 1}</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5" title="Wave">
                        <Users className="h-5 w-5" />
                        <span className="hidden sm:inline">WAVE:</span> 
                        <span>{wave}</span>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-x-2 pointer-events-auto">
                 <SettingsDialog>
                    <Button variant="outline" size="icon" className="h-10 w-10 rounded-full bg-black/30 text-white border-primary/50 backdrop-blur-sm hover:bg-primary/50">
                        <Settings className="h-5 w-5"/>
                        <span className="sr-only">Settings</span>
                    </Button>
                </SettingsDialog>
                <Button onClick={onLeaveGame} variant="outline" size="icon" className="h-10 w-10 rounded-full bg-black/30 text-white border-primary/50 backdrop-blur-sm hover:bg-destructive/50">
                    <Home className="h-5 w-5"/>
                    <span className="sr-only">Home</span>
                </Button>
            </div>
        </div>
      </div>
    </div>
  );
}
