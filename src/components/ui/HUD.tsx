
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import ServerLeaderboard from './ServerLeaderboard';
import type { MapSchema } from '@colyseus/schema';
import type { Player } from '@/server/rooms/state/VoxelAcesState';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Plus, Flame, ArrowUp, Star, Users } from 'lucide-react';


interface HUDProps {
  score: number;
  wave: number;
  health: number;
  overheat: number;
  altitude: number;
  mode: 'offline' | 'online';
  players?: MapSchema<Player>;
}

export default function HUD({ score, wave, health, overheat, altitude, mode, players }: HUDProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="absolute top-0 left-0 right-0 p-2 text-white font-headline pointer-events-none select-none bg-black/20 backdrop-blur-sm z-10">
        <div className="flex justify-between items-center text-sm">
          {/* Left Stats */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Plus className="h-4 w-4 text-green-400" />
              <span>{health}</span>
            </div>
            <div className="flex items-center gap-1">
              <Flame className="h-4 w-4 text-orange-400" />
              <span>{Math.round(overheat)}</span>
            </div>
            <div className="flex items-center gap-1">
              <ArrowUp className="h-4 w-4" />
              <span>{Math.round(altitude)}m</span>
            </div>
          </div>

          {/* Right Stats */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 text-yellow-400" />
              <span>{score}</span>
            </div>
            {mode === 'online' ? (
                <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{players?.size || 1}</span>
                </div>
            ) : (
                <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>WAVE: {wave}</span>
                </div>
            )}
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 right-4 text-white font-headline pointer-events-none select-none">
      <div className="flex justify-between items-start">
        <Card className="w-52 sm:w-64 bg-black/30 backdrop-blur-sm border-primary/50 text-primary-foreground p-2">
          <CardContent className="p-2 space-y-2">
            <div>
              <label className="text-sm font-medium">HEALTH</label>
              <Progress value={health} className="h-4 bg-red-900/50" indicatorClassName="bg-green-500" />
            </div>
            <div>
              <label className="text-sm font-medium">GUN HEAT</label>
              <Progress value={overheat} className="h-4 bg-gray-600/50" indicatorClassName="bg-accent" />
            </div>
            <div>
              <label className="text-sm font-medium">ALTITUDE</label>
              <div className="text-xl font-bold">{Math.round(altitude)}m</div>
            </div>
          </CardContent>
        </Card>

        {mode === 'online' && players ? (
          <ServerLeaderboard players={players} />
        ) : (
          <Card className="text-right bg-black/30 backdrop-blur-sm border-primary/50 text-primary-foreground p-2">
            <CardContent className="p-2 min-w-[140px] sm:min-w-[160px]">
              <div className="text-xl sm:text-2xl font-bold">SCORE: {score}</div>
              <div className="text-base sm:text-lg">WAVE: {wave}</div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
