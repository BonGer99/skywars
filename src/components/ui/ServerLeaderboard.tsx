
'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Crown } from 'lucide-react';

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

    const q = query(
      collection(db, 'servers', serverId, 'players'),
      orderBy('kills', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const playersData: Player[] = [];
      querySnapshot.forEach((doc) => {
        playersData.push({ id: doc.id, ...doc.data() } as Player);
      });
      setPlayers(playersData);
    });

    return () => unsubscribe();
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
            {players.map((player, index) => (
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
