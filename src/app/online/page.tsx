'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Copy, Users, Globe, Server as ServerIcon, User, Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';

import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, doc, addDoc, deleteDoc, runTransaction, getDocs, writeBatch, serverTimestamp, orderBy } from 'firebase/firestore';


type Server = {
  id: string;
  name: string;
  region: string;
  players: number;
  maxPlayers: number;
};

type LobbyPlayer = {
  id: string;
  name: string;
};

const initialServers: Omit<Server, 'id' | 'players'>[] = [
  { name: 'Voxel Skies - East US', region: 'East US', maxPlayers: 24 },
  { name: 'Aces High - Europe', region: 'Europe', maxPlayers: 24 },
  { name: 'Dogfight Arena - Asia', region: 'Asia', maxPlayers: 24 },
  { name: 'G-Force Giants - South America', region: 'S. America', maxPlayers: 24 },
];

async function seedServers() {
  const serversCollection = collection(db, 'servers');
  const snapshot = await getDocs(serversCollection);
  if (snapshot.empty) {
    console.log('No servers found, seeding initial data...');
    const batch = writeBatch(db);
    initialServers.forEach(serverData => {
      const serverRef = doc(serversCollection);
      batch.set(serverRef, { ...serverData, players: 0 });
    });
    await batch.commit();
    console.log('Seeding complete.');
  }
}

function OnlinePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [playerName, setPlayerName] = useState('');
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joinedServer, setJoinedServer] = useState<Server | null>(null);
  const [playersInLobby, setPlayersInLobby] = useState<LobbyPlayer[]>([]);
  const [playerDocId, setPlayerDocId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    seedServers();
    const q = query(collection(db, 'servers'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const serversData: Server[] = [];
      querySnapshot.forEach((doc) => {
        serversData.push({ id: doc.id, ...doc.data() } as Server);
      });
      // A true ping-based sort would require a more complex client-server check.
      // For now, we'll just show the first three available servers.
      setServers(serversData.slice(0, 3));
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching servers:", error);
      toast({
        title: "Error",
        description: "Could not connect to the game servers. Please check your Firebase setup.",
        variant: "destructive",
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  useEffect(() => {
    if (!joinedServer) return;

    const playersQuery = query(collection(db, `servers/${joinedServer.id}/players`), orderBy('joinedAt', 'asc'));
    const unsubscribe = onSnapshot(playersQuery, (snapshot) => {
      const playersData: LobbyPlayer[] = [];
      snapshot.forEach(doc => {
        playersData.push({ id: doc.id, name: doc.data().name });
      });
      setPlayersInLobby(playersData);
    });

    return () => unsubscribe();
  }, [joinedServer]);

  useEffect(() => {
    const serverId = searchParams.get('server');
    if (serverId && servers.length > 0) {
      const serverToJoin = servers.find(s => s.id === serverId);
      // Ensure player hasn't already joined to prevent re-joining on hot-reload
      if (serverToJoin && !joinedServer) {
        handleJoinServer(serverToJoin);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, servers]);

  const handleJoinServer = async (server: Server) => {
    if (!playerName) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining a server.",
        variant: "destructive",
      });
      return;
    }

    setJoinedServer(server);
    const serverRef = doc(db, 'servers', server.id);
    const playersRef = collection(db, `servers/${server.id}/players`);

    try {
      const playerDocRef = await addDoc(playersRef, {
        name: playerName,
        joinedAt: serverTimestamp(),
      });
      setPlayerDocId(playerDocRef.id);
      
      await runTransaction(db, async (transaction) => {
        const serverDoc = await transaction.get(serverRef);
        if (!serverDoc.exists()) {
          throw "Server does not exist!";
        }
        const newPlayerCount = (serverDoc.data().players || 0) + 1;
        transaction.update(serverRef, { players: newPlayerCount });
      });

    } catch (e) {
      console.error("Error joining server: ", e);
      toast({ title: "Error", description: "Could not join the server.", variant: "destructive" });
      setJoinedServer(null);
    }
  };

  const handleLeaveServer = async () => {
    if (!joinedServer || !playerDocId) return;

    const serverRef = doc(db, 'servers', joinedServer.id);
    const playerDocRef = doc(db, `servers/${joinedServer.id}/players`, playerDocId);
    
    try {
      await deleteDoc(playerDocRef);
      await runTransaction(db, async (transaction) => {
        const serverDoc = await transaction.get(serverRef);
        if (serverDoc.exists()) {
          const newPlayerCount = Math.max(0, (serverDoc.data().players || 1) - 1);
          transaction.update(serverRef, { players: newPlayerCount });
        }
      });
      
      // Clear state and navigate only after successful DB operations
      setJoinedServer(null);
      setPlayerDocId(null);
      setPlayersInLobby([]);
      router.push('/online'); // Clear query params
    } catch (e) {
      console.error("Error leaving server: ", e);
      toast({
        title: "Error",
        description: "Could not leave the server. Please try again.",
        variant: "destructive",
      });
    }
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
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-primary text-xl">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        Loading Servers...
      </div>
    );
  }

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
                    <h3 className="font-semibold text-lg mb-2">Players in Lobby ({playersInLobby.length}/{joinedServer.maxPlayers})</h3>
                     <div className="max-h-60 overflow-y-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Callsign</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {playersInLobby.map(player => (
                                  <TableRow key={player.id} className={player.name === playerName ? "bg-accent/20" : ""}>
                                      <TableCell className="font-medium flex items-center gap-2"><User className="h-4 w-4"/>{player.name} {player.name === playerName ? '(You)' : ''}</TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg">Invite Your Squadron</h3>
                    <p className="text-sm text-muted-foreground">Share this link with your friends to have them join this server directly.</p>
                     <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                        <p className="text-sm font-mono truncate">
                           {typeof window !== 'undefined' ? `${window.location.origin.replace(/https?:\/\//, '')}/online?server=${joinedServer.id}` : ''}
                        </p>
                        <Button variant="ghost" size="icon" onClick={copyInviteLink}>
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                     <Link href="/play" passHref className="w-full">
                        <Button size="lg" className="w-full">Ready to Fly</Button>
                     </Link>
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
          <CardTitle className="text-4xl font-bold font-headline text-primary">Join a Server</CardTitle>
          <CardDescription>
            Enter your callsign, then choose from the top servers to join the fight.
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
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {servers.map((server) => (
          <Card key={server.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ServerIcon className="text-primary"/>{server.name}</CardTitle>

              <CardDescription className="flex items-center gap-4 pt-2">
                <span className="flex items-center gap-1"><Globe className="h-4 w-4"/> {server.region}</span>
                <span className="flex items-center gap-1"><Users className="h-4 w-4"/> {server.players}/{server.maxPlayers}</span>
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button className="w-full" onClick={() => handleJoinServer(server)} disabled={server.players >= server.maxPlayers}>
                {server.players >= server.maxPlayers ? 'Server Full' : 'Join Server'}
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
      <Suspense fallback={
          <div className="flex items-center justify-center min-h-screen text-primary text-xl">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Loading...
          </div>
      }>
        <OnlinePageContent />
      </Suspense>
    </main>
  );
}
