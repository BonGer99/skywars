'use client';

import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Mock data, will be replaced with real-time data from Firebase
const leaderboardData = [
  { rank: 1, player: 'AcePilot_1', kills: 128 },
  { rank: 2, player: 'Maverick', kills: 112 },
  { rank: 3, player: 'SkyRider', kills: 98 },
  { rank: 4, player: 'VoxelViper', kills: 85 },
  { rank: 5, player: 'RedBaron', kills: 77 },
  { rank: 6, player: 'CloudDancer', kills: 64 },
  { rank: 7, player: 'GhostRider', kills: 59 },
  { rank: 8, player: 'NightHawk', kills: 51 },
  { rank: 9, player: 'Phoenix', kills: 45 },
  { rank: 10, player: 'YourPlayerName', kills: 0 },
];

export default function Leaderboard() {
  // In the future, this component will fetch data from Firestore
  // For now, it uses mock data.

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Aces Leaderboard</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-y-auto">
            <Table>
            <TableHeader>
                <TableRow>
                <TableHead className="w-[80px]">Rank</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Kills</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {leaderboardData.map((entry) => (
                <TableRow key={entry.rank}>
                    <TableCell className="font-medium">{entry.rank}</TableCell>
                    <TableCell>{entry.player}</TableCell>
                    <TableCell className="text-right">{entry.kills}</TableCell>
                </TableRow>
                ))}
            </TableBody>
            </Table>
        </div>
      </CardContent>
    </Card>
  );
}
