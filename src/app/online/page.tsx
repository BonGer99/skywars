
'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, doc, getDoc, setDoc } from 'firebase/firestore';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

type ServerInfo = {
  id: string;
  name: string;
  region: string;
  maxPlayers: number;
};

const initialServers: Omit<ServerInfo, 'id'> & { id: string }[] = [
  { id: 'europe-server', name: 'Aces High - Europe', region: 'Europe', maxPlayers: 24 },
];

async function seedServers() {
    console.log('Checking for servers...');
    try {
        for (const serverData of initialServers) {
            const serverRef = doc(db, 'servers', serverData.id);
            const docSnap = await getDoc(serverRef);

            if (!docSnap.exists()) {
                console.log(`Server ${serverData.id} not found, seeding...`);
                await setDoc(serverRef, { ...serverData, players: 0 }); // Seed with deprecated players field
            }
        }
        console.log('Server check complete.');
    } catch (error) {
        console.error("Error seeding servers: ", error);
        throw error;
    }
}


function OnlinePageContent() {
  const router = useRouter();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [playerName, setPlayerName] = useState('');
  const [isJoining, setIsJoining] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const memoizedSeedServers = useCallback(() => {
    seedServers().catch(err => {
        console.error("Failed to seed servers:", err);
        const description = "Could not initialize game servers. This is often due to Firestore security rules or network issues. Please check your Firebase console and internet connection.";
        setError(description);
        toast({
            title: "Server Initialization Failed",
            description: description,
            variant: "destructive",
        });
        setIsLoading(false);
    });
  }, [toast]);

  // Effect to get static server metadata
  useEffect(() => {
    memoizedSeedServers();

    const q = query(collection(db, 'servers'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const serversData: ServerInfo[] = [];
      querySnapshot.forEach((doc) => {
        serversData.push({ id: doc.id, ...doc.data() } as ServerInfo);
      });
      setServers(serversData);
      setError(null);
      setIsLoading(false);
    }, (err) => {
      console.error("Error fetching servers: ", err);
      const description = `Failed to connect to the server list. This can happen if your Firestore Security Rules are too restrictive. Please ensure they allow reads on the 'servers' collection. (Error: ${err.message})`;
      setError(description);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [memoizedSeedServers]);
  
  // Effect to get live player counts for each server
  useEffect(() => {
    if (servers.length === 0) return;

    const unsubscribers = servers.map(server => {
      const playersQuery = query(collection(db, 'servers', server.id, 'players'));

      return onSnapshot(playersQuery, (snapshot) => {
        const now = Date.now();
        const STALE_THRESHOLD_MS = 15000; // 15 seconds
        let activePlayers = 0;

        snapshot.forEach(doc => {
          const playerData = doc.data();
          const lastSeenTimestamp = playerData.lastSeen?.toDate()?.getTime();
          if (lastSeenTimestamp && (now - lastSeenTimestamp) < STALE_THRESHOLD_MS) {
            activePlayers++;
          }
        });

        setPlayerCounts(prev => ({ ...prev, [server.id]: activePlayers }));
      });
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [servers]);

  const handleJoinServer = async (server: ServerInfo) => {
    if (!playerName) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining a server.",
        variant: "destructive",
      });
      return;
    }
    
    const playerCount = playerCounts[server.id] ?? 0;

    if (playerCount >= server.maxPlayers) {
      toast({
        title: "Server Full",
        description: "This server is currently full. Please try another one.",
        variant: "destructive",
      });
      return;
    }

    setIsJoining(server.id);

    router.push(`/online-game?server=${server.id}&playerName=${encodeURIComponent(playerName)}`);
  };

  return (
    <div className="w-full max-w-4xl space-y-8">
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
              ) : error ? (
                <Alert variant="destructive">
                  <AlertTitle>Connection Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : servers.length === 0 ? (
                <div className="text-center text-muted-foreground p-4 border border-dashed rounded-lg">
                    <p>No servers available.</p>
                    <p className="text-sm">This may be due to a network issue or restrictive Firestore security rules.</p>
                </div>
              ) : (
                <div className="border rounded-lg">
                  {servers.map((server) => {
                    const playerCount = playerCounts[server.id] ?? 0;
                    const isFull = playerCount >= server.maxPlayers;
                    return (
                        <div key={server.id} className="flex items-center justify-between p-4 border-b last:border-b-0">
                            <div>
                                <p className="font-semibold text-lg">{server.name}</p>
                                <p className="text-sm text-muted-foreground">{server.region}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Users className="h-4 w-4" />
                                    <span>{playerCount} / {server.maxPlayers}</span>
                                </div>
                                <Button 
                                    onClick={() => handleJoinServer(server)} 
                                    disabled={isJoining === server.id || isFull}
                                >
                                {isJoining === server.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {isFull ? 'Full' : 'Join'}
                                </Button>
                            </div>
                        </div>
                    );
                  })}
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
