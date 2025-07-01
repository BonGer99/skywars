
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Crown } from 'lucide-react';
import type { ArraySchema } from '@colyseus/schema';
import type { LeaderboardEntry } from '@/server/rooms/state/VoxelAcesState';

interface ServerLeaderboardProps {
  leaderboard: ArraySchema<LeaderboardEntry>;
}

export default function ServerLeaderboard({ leaderboard: leaderboardState }: ServerLeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  
  useEffect(() => {
    if (!leaderboardState) return;

    // Function to copy state to local react state
    const updateLeaderboard = () => {
        setLeaderboard([...leaderboardState.slice()]);
    };
    
    // Initial update
    updateLeaderboard();
    
    // Listen for additions, removals, and changes
    const onAdd = leaderboardState.onAdd(updateLeaderboard);
    const onRemove = leaderboardState.onRemove(updateLeaderboard);
    const onChange = leaderboardState.onChange(updateLeaderboard);
    
    // Cleanup listeners
    return () => {
        onAdd();
        onRemove();
        onChange();
    };
    
  }, [leaderboardState]);

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
