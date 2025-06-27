
'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, doc, addDoc, getDocs, writeBatch, serverTimestamp, runTransaction } from 'firebase/firestore';

type Server = {
  id: string;
  name: string;
  region: string;
  players: number;
  maxPlayers: number;
};

const initialServers: Omit<Server, 'id' | 'players'>[] = [
  { name: 'Aces High - US East', region: 'US East', maxPlayers: 24 },
  { name: 'Aces High - Europe', region: 'Europe', maxPlayers: 24 },
  { name: 'Aces High - Asia', region: 'Asia', maxPlayers: 24 },
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
  const [servers, setServers] = useState<Server[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [isJoining, setIsJoining] = useState<string | null>(null); // Store server ID being joined
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Seed servers once on component mount if they don't exist.
    seedServers().catch(error => {
        console.error("Failed to seed servers:", error);
        toast({
            title: "Server Initialization Failed",
            description: "Could not prepare game servers. Please check your connection and try again.",
            variant: "destructive",
        });
    });

    const q = query(collection(db, 'servers'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const serversData: Server[] = [];
      querySnapshot.forEach((doc) => {
        serversData.push({ id: doc.id, ...doc.data() } as Server);
      });
      setServers(serversData);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching servers: ", error);
      toast({
          title: "Connection Error",
          description: "Could not connect to the server list. Please check your connection and try again.",
          variant: "destructive"
      });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

  const handleJoinServer = async (server: Server) => {
    if (!playerName) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining a server.",
        variant: "destructive",
      });
      return;
    }

    if (server.players >= server.maxPlayers) {
      toast({
        title: "Server Full",
        description: "This server is currently full. Please try another one.",
        variant: "destructive",
      });
      return;
    }

    setIsJoining(server.id);

    try {
      const serverRef = doc(db, 'servers', server.id);
      const playersRef = collection(db, `servers/${server.id}/players`);
      
      const playerDocRef = await addDoc(playersRef, {
        name: playerName,
        joinedAt: serverTimestamp(),
        kills: 0,
      });
      
      await runTransaction(db, async (transaction) => {
        const freshServerDoc = await transaction.get(serverRef);
        if (!freshServerDoc.exists()) {
          throw "Server does not exist!";
        }
        const newPlayerCount = (freshServerDoc.data().players || 0) + 1;
        transaction.update(serverRef, { players: newPlayerCount });
      });

      router.push(`/online-game?server=${server.id}&player=${playerDocRef.id}`);

    } catch (e) {
      console.error("Error joining server: ", e);
      toast({ title: "Error", description: "Could not join the server. Please try again.", variant: "destructive" });
      setIsJoining(null);
    }
  };

  return (
    <div className="w-full max-w-2xl space-y-8">
      <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-bold font-headline text-primary">Online Multiplayer</CardTitle>
          <CardDescription>
            Enter your callsign and choose a server to join the fight.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="space-y-2 max-w-sm mx-auto">
              <Label htmlFor="playerName" className="sr-only">Your Callsign</Label>
              <Input 
                id="playerName" 
                placeholder="Enter Your Callsign" 
                value={playerName} 
                onChange={(e) => setPlayerName(e.target.value)} 
                className="text-lg text-center"
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-center text-xl font-semibold text-foreground/90">Server List</h3>
              {isLoading ? (
                 <div className="flex justify-center items-center h-40">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                 </div>
              ) : servers.length === 0 ? (
                <p className="text-center text-muted-foreground">No servers available. Please check your connection or try again later.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {servers.map((server) => (
                    <Card key={server.id} className="flex flex-col">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">{server.name}</CardTitle>
                        <CardDescription>{server.region}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-grow flex items-center justify-between">
                         <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span>{server.players} / {server.maxPlayers}</span>
                         </div>
                      </CardContent>
                      <CardFooter>
                         <Button 
                            className="w-full"
                            onClick={() => handleJoinServer(server)} 
                            disabled={isJoining === server.id || server.players >= server.maxPlayers}
                          >
                           {isJoining === server.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                           {server.players >= server.maxPlayers ? 'Full' : 'Join'}
                         </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </div>
        </CardContent>
        <CardFooter>
             <Link href="/" passHref className="mx-auto">
                <Button size="lg" variant="outline">
                    <ArrowLeft className="mr-2 h-5 w-5" />
                    Back to Main Menu
                </Button>
             </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function OnlinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 sm:p-24 bg-background">
        <OnlinePageContent />
    </main>
  );
}
