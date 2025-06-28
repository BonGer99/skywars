
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Crown } from 'lucide-react';
import { getFullState } from '@/app/game-actions';


interface ServerLeaderboardProps {
  serverId: string;
}

type Player = {
  id: string;
  name: string;
  kills: number;
};

export default function ServerLeaderboard({ serverId }: ServerLeaderboardProps) {
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    if (!serverId) return;

    const fetchLeaderboard = async () => {
        try {
            const state = await getFullState(serverId);
            if (state && state.players) {
                const playersData: Player[] = Object.values(state.players)
                    .map((p: any) => ({ id: p.id, name: p.name, kills: p.kills, isAI: p.isAI }))
                    .filter(p => !p.isAI) // Don't show AI on leaderboard
                    .sort((a, b) => b.kills - a.kills)
                    .slice(0, 5);
                setPlayers(playersData);
            }
        } catch (e) {
            console.error("Failed to fetch leaderboard", e);
        }
    };
    
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 2000); // update leaderboard every 2 seconds

    return () => clearInterval(interval);
  }, [serverId]);

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
            {players.map((player) => (
              <TableRow key={player.id} className="border-b-0">
                <TableCell className="p-1 font-medium truncate">{player.name}</TableCell>
                <TableCell className="p-1 text-right">{player.kills}</TableCell>
              </TableRow>
            ))}
            {players.length === 0 && (
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
