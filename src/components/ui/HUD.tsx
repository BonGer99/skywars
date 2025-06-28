
import { Button } from '@/components/ui/button';
import type { MapSchema } from '@colyseus/schema';
import type { Player } from '@/server/rooms/state/VoxelAcesState';
import { Plus, Flame, ArrowUp, Star, Users, Home } from 'lucide-react';

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
      <div className="flex justify-between items-center">
        {/* Left Stats */}
        <div className="flex items-center gap-x-4 text-lg">
          <div className="flex items-center gap-1.5" title="Health">
            <Plus className="h-5 w-5 text-green-400" />
            <span>{health}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Gun Overheat">
            <Flame className="h-5 w-5 text-orange-400" />
            <span>{Math.round(overheat)}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Altitude">
            <ArrowUp className="h-5 w-5" />
            <span>{Math.round(altitude)}m</span>
          </div>
        </div>

        {/* Right Stats & Actions */}
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
            <Button onClick={onLeaveGame} variant="outline" size="icon" className="h-10 w-10 rounded-full bg-black/30 text-white border-primary/50 backdrop-blur-sm hover:bg-destructive/50 pointer-events-auto">
                <Home className="h-5 w-5"/>
                <span className="sr-only">Home</span>
            </Button>
        </div>
      </div>
    </div>
  );
}
