
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Crown } from 'lucide-react';
import type { MapSchema } from '@colyseus/schema';
import type { Player as PlayerState } from '@/server/rooms/state/VoxelAcesState';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface ServerLeaderboardProps {
  players: MapSchema<PlayerState>;
}

type Player = {
  id: string;
  name: string;
  kills: number;
};

export default function ServerLeaderboard({ players: playersMap }: ServerLeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const isMobile = useIsMobile();

  useEffect(() => {
    const leaderboardLimit = isMobile ? 3 : 5;
    
    const updateLeaderboard = () => {
      const playersData: Player[] = [];
      playersMap.forEach((player, id) => {
        playersData.push({ id, name: player.name, kills: player.kills });
      });
      
      const sortedPlayers = playersData
        .sort((a, b) => b.kills - a.kills)
        .slice(0, leaderboardLimit);
        
      setLeaderboard(sortedPlayers);
    };

    // Initial update
    updateLeaderboard();

    // Map to store listeners for each player
    const playerListeners = new Map<string, any[]>();

    const addPlayerListeners = (player: PlayerState, id: string) => {
        // listen for changes on individual player properties
        const listeners = [
            player.listen("kills", updateLeaderboard),
            player.listen("name", updateLeaderboard),
        ];
        playerListeners.set(id, listeners);
    };

    // Setup listeners for existing players
    playersMap.forEach(addPlayerListeners);

    // Setup listeners for players added in the future
    const onAdd = playersMap.onAdd((player, id) => {
        addPlayerListeners(player, id);
        updateLeaderboard();
    });

    // Setup listeners for players removed in the future
    const onRemove = playersMap.onRemove((_, id) => {
        if (playerListeners.has(id)) {
            playerListeners.get(id)?.forEach(l => l.clear());
            playerListeners.delete(id);
        }
        updateLeaderboard();
    });

    // Cleanup function
    return () => {
        onAdd();
        onRemove();
        playerListeners.forEach(listeners => listeners.forEach(l => l.clear()));
    }

  }, [playersMap, isMobile]);

  return (
    <Card className="w-48 sm:w-60 bg-black/30 backdrop-blur-sm border-primary/50 text-primary-foreground p-1">
      <CardHeader className="p-2 pb-0">
        <CardTitle className="text-sm sm:text-base flex items-center justify-center gap-2">
          <Crown className="h-4 w-4 text-amber-400" />
          Top Aces
        </CardTitle>
      </CardHeader>
      <CardContent className="p-1 sm:p-2">
        <Table>
          <TableHeader>
            <TableRow className="border-b-primary/30">
              <TableHead className="h-8 p-1 text-xs text-primary-foreground/80">Player</TableHead>
              <TableHead className="h-8 p-1 text-xs text-right text-primary-foreground/80">Kills</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboard.map((player) => (
              <TableRow key={player.id} className="border-b-0">
                <TableCell className="p-1 text-xs sm:text-sm font-medium truncate">{player.name}</TableCell>
                <TableCell className="p-1 text-xs sm:text-sm text-right">{player.kills}</TableCell>
              </TableRow>
            ))}
            {leaderboard.length === 0 && (
                <TableRow className="border-b-0">
                    <TableCell colSpan={2} className="p-1 text-center text-xs text-muted-foreground">No players yet.</TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
