
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import ServerLeaderboard from './ServerLeaderboard';

interface HUDProps {
  score: number;
  wave: number;
  health: number;
  overheat: number;
  altitude: number;
  mode: 'offline' | 'online';
  serverId?: string;
}

export default function HUD({ score, wave, health, overheat, altitude, mode, serverId }: HUDProps) {
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

        {mode === 'online' && serverId ? (
          <ServerLeaderboard serverId={serverId} />
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
