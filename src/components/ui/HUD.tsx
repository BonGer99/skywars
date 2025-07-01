import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { MapSchema, ArraySchema } from '@colyseus/schema';
import type { Player, LeaderboardEntry } from '@/server/rooms/state/VoxelAcesState';
import { Plus, Flame, ArrowUp, Star, Users, Home, Settings } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import ServerLeaderboard from './ServerLeaderboard';

interface HUDProps {
  score: number;
  wave: number;
  health: number;
  overheat: number;
  altitude: number;
  mode: 'offline' | 'online';
  players?: MapSchema<Player>;
  leaderboard?: ArraySchema<LeaderboardEntry>;
  onLeaveGame: () => void;
}

export default function HUD({ score, wave, health, overheat, altitude, mode, players, leaderboard, onLeaveGame }: HUDProps) {
  return (
    <div className="absolute inset-0 p-2 sm:p-4 text-white font-headline pointer-events-none select-none z-10 flex justify-between items-start">
      {/* Left Stats */}
      <div className="bg-black/20 backdrop-blur-sm p-2 rounded-lg flex items-center gap-x-2 sm:gap-x-4 text-lg pointer-events-auto">
        <div className="flex items-center gap-1 sm:gap-1.5" title="Health">
          <Plus className="h-5 w-5 text-green-400" />
          <Progress value={health} className="w-16 sm:w-24 h-2" indicatorClassName="bg-green-400" />
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5" title="Gun Overheat">
          <Flame className="h-5 w-5 text-orange-400" />
          <Progress value={overheat} className="w-16 sm:w-24 h-2" indicatorClassName="bg-orange-400" />
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5" title="Altitude">
          <ArrowUp className="h-5 w-5" />
          <span className="text-base sm:text-lg">{Math.round(altitude)}m</span>
        </div>
      </div>

      {/* Right Stats & Actions */}
      <div className="flex flex-col items-end gap-y-2 pointer-events-auto">
        {mode === 'online' && leaderboard && <ServerLeaderboard leaderboard={leaderboard} />}
        
        <div className="bg-black/20 backdrop-blur-sm p-2 rounded-lg flex items-center gap-x-2 sm:gap-x-4 text-lg">
            <div className="flex items-center gap-1 sm:gap-1.5" title="Kills">
              <Star className="h-5 w-5 text-yellow-400" />
              <span className="text-base sm:text-lg">{score}</span>
            </div>
            {mode === 'online' ? (
                <div className="flex items-center gap-1 sm:gap-1.5" title="Players">
                    <Users className="h-5 w-5" />
                    <span className="text-base sm:text-lg">{players?.size || 1}</span>
                </div>
            ) : (
                <div className="flex items-center gap-1 sm:gap-1.5" title="Wave">
                    <Users className="h-5 w-5" />
                    <span className="hidden sm:inline text-base sm:text-lg">WAVE:</span> 
                    <span className="text-base sm:text-lg">{wave}</span>
                </div>
            )}
        </div>
        <div className="flex items-center gap-x-1">
             <SettingsDialog>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                    <Settings className="h-5 w-5"/>
                    <span className="sr-only">Settings</span>
                </Button>
            </SettingsDialog>
            <Button onClick={onLeaveGame} variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                <Home className="h-5 w-5"/>
                <span className="sr-only">Home</span>
            </Button>
        </div>
      </div>
    </div>
  );
}
