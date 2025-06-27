'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Copy, Users, Globe, Server as ServerIcon, User } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';

type Server = {
  id: string;
  name: string;
  region: string;
  players: number;
  maxPlayers: number;
};

// Mock data for public servers
const mockServers: Server[] = [
  { id: 'us-east-1', name: 'Voxel Skies - East US', region: 'East US', players: 12, maxPlayers: 24 },
  { id: 'eu-west-1', name: 'Aces High - Europe', region: 'Europe', players: 20, maxPlayers: 24 },
  { id: 'asia-se-1', name: 'Dogfight Arena - Asia', region: 'Asia', players: 8, maxPlayers: 24 },
  { id: 'sa-east-1', name: 'G-Force Giants - South America', region: 'S. America', players: 5, maxPlayers: 24 },
];

function OnlinePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [playerName, setPlayerName] = useState('');
  const [joinedServer, setJoinedServer] = useState<Server | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const serverId = searchParams.get('server');
    if (serverId) {
      const serverToJoin = mockServers.find(s => s.id === serverId);
      if (serverToJoin) {
        setJoinedServer(serverToJoin);
      }
    }
  }, [searchParams]);
  
  const handleJoinServer = (server: Server) => {
    if (!playerName) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining a server.",
        variant: "destructive",
      });
      return;
    }
    setJoinedServer(server);
  };
  
  const handleLeaveServer = () => {
    setJoinedServer(null);
    router.push('/online'); // Clear query params
  };
  
  const copyInviteLink = () => {
    if (joinedServer) {
      const inviteLink = `${window.location.origin}/online?server=${joinedServer.id}`;
      navigator.clipboard.writeText(inviteLink);
      toast({
        title: "Copied to clipboard!",
        description: "Invite link is ready to be shared.",
      });
    }
  };

  if (joinedServer) {
    // In-Server Lobby View
    return (
      <div className="w-full max-w-4xl">
        <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl">
          <CardHeader>
            <CardTitle className="text-3xl font-bold font-headline text-primary">{joinedServer.name}</CardTitle>
            <CardDescription>
              Region: {joinedServer.region} | Your Callsign: <span className="font-bold text-accent">{playerName || 'Maverick'}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 className="font-semibold text-lg mb-2">Players in Lobby</h3>
                     <div className="max-h-60 overflow-y-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Callsign</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow className="bg-accent/20">
                                    <TableCell className="font-medium flex items-center gap-2"><User className="h-4 w-4"/>{playerName || 'Maverick'} (You)</TableCell>
                                </TableRow>
                                <TableRow><TableCell className="flex items-center gap-2"><User className="h-4 w-4"/>RedBaron</TableCell></TableRow>
                                <TableRow><TableCell className="flex items-center gap-2"><User className="h-4 w-4"/>SkyRider</TableCell></TableRow>
                                <TableRow><TableCell className="flex items-center gap-2"><User className="h-4 w-4"/>VoxelViper</TableCell></TableRow>
                            </TableBody>
                        </Table>
                    </div>
                </div>
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg">Invite Your Squadron</h3>
                    <p className="text-sm text-muted-foreground">Share this link with your friends to have them join this server directly.</p>
                     <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                        <p className="text-sm font-mono truncate">
                           {typeof window !== 'undefined' ? `${window.location.origin.replace('https://', '')}/online?server=${joinedServer.id}` : ''}
                        </p>
                        <Button variant="ghost" size="icon" onClick={copyInviteLink}>
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                     <Button size="lg" className="w-full" disabled>Ready to Fly (Coming Soon)</Button>
                </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col sm:flex-row gap-2">
            <Button size="lg" variant="destructive" className="w-full sm:w-auto" onClick={handleLeaveServer}>
                Leave Server
            </Button>
             <Link href="/" passHref className="w-full sm:w-auto ml-auto block">
                <Button size="lg" variant="outline" className="w-full">
                    <ArrowLeft className="mr-2 h-5 w-5" />
                    Back to Main Menu
                </Button>
             </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Server List View
  return (
    <div className="w-full max-w-5xl space-y-8">
      <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
        <CardHeader>
          <CardTitle className="text-4xl font-bold font-headline text-primary">Public Servers</CardTitle>
          <CardDescription>
            Enter your callsign, then choose a server to join the fight.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm mx-auto">
            <div className="space-y-2">
              <Label htmlFor="playerName" className="sr-only">Your Callsign</Label>
              <Input 
                id="playerName" 
                placeholder="Enter Your Callsign" 
                value={playerName} 
                onChange={(e) => setPlayerName(e.target.value)} 
                className="text-lg text-center"
              />
            </div>
        </CardContent>
      </Card>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {mockServers.map((server) => (
          <Card key={server.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ServerIcon className="text-primary"/>{server.name}</CardTitle>

              <CardDescription className="flex items-center gap-4 pt-2">
                <span className="flex items-center gap-1"><Globe className="h-4 w-4"/> {server.region}</span>
                <span className="flex items-center gap-1"><Users className="h-4 w-4"/> {server.players}/{server.maxPlayers}</span>
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button className="w-full" onClick={() => handleJoinServer(server)}>
                Join Server
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      
       <Separator />
       <div className="text-center">
         <Link href="/" passHref>
            <Button size="lg" variant="outline" className="text-lg py-6">
                <ArrowLeft className="mr-2 h-6 w-6" />
                Back to Main Menu
            </Button>
         </Link>
       </div>
    </div>
  );
}

// Using Suspense as useSearchParams requires it.
export default function OnlinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 sm:p-24 bg-background">
      <Suspense fallback={<div className="text-primary text-xl">Loading Servers...</div>}>
        <OnlinePageContent />
      </Suspense>
    </main>
  );
}
