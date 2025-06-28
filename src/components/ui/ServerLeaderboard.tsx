
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Crown } from 'lucide-react';
import type { MapSchema } from '@colyseus/schema';
import type { Player as PlayerState } from '@/server/rooms/state/VoxelAcesState';

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

  useEffect(() => {
    // This function will be triggered by Colyseus on any change
    const updateLeaderboard = () => {
      const playersData: Player[] = [];
      playersMap.forEach((player, id) => {
        playersData.push({ id, name: player.name, kills: player.kills });
      });
      
      const sortedPlayers = playersData
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 5);
        
      setLeaderboard(sortedPlayers);
    };

    // Initial update
    updateLeaderboard();

    // Listen for changes
    playersMap.onAdd = updateLeaderboard;
    playersMap.onRemove = updateLeaderboard;
    playersMap.onChange = updateLeaderboard;

    return () => {
        playersMap.onAdd = () => {};
        playersMap.onRemove = () => {};
        playersMap.onChange = () => {};
    }

  }, [playersMap]);

  return (
    <Card className="w-52 sm:w-64 bg-black/30 backdrop-blur-sm border-primary/50 text-primary-foreground p-2">
      <CardHeader className="p-2 pb-0">
        <CardTitle className="text-base flex items-center justify-center gap-2">
          <Crown className="h-4 w-4 text-amber-400" />
          Top Aces
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
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
                <TableCell className="p-1 font-medium truncate">{player.name}</TableCell>
                <TableCell className="p-1 text-right">{player.kills}</TableCell>
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
