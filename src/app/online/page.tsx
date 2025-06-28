
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
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { getServerList } from '@/app/game-actions';


type ServerInfo = {
  id: string;
  name: string;
  region: string;
  maxPlayers: number;
  playerCount: number;
};


function OnlinePageContent() {
  const router = useRouter();
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [isJoining, setIsJoining] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchServers = useCallback(async () => {
    setIsLoading(true);
    try {
      const serverList = await getServerList();
      setServers(serverList);
      setError(null);
    } catch (err: any) {
      console.error("Error fetching servers: ", err);
      const description = `Failed to connect to the server list. The game server might be restarting. Please try again in a moment. (Error: ${err.message})`;
      setError(description);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, 5000); // Refresh server list every 5 seconds
    return () => clearInterval(interval);
  }, [fetchServers]);


  const handleJoinServer = async (server: ServerInfo) => {
    if (!playerName) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining a server.",
        variant: "destructive",
      });
      return;
    }
    
    if (server.playerCount >= server.maxPlayers) {
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
              {isLoading && servers.length === 0 ? (
                 <div className="flex justify-center items-center h-40">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                 </div>
              ) : error ? (
                <Alert variant="destructive">
                  <AlertTitle>Connection Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : servers.length === 0 && !isLoading ? (
                <div className="text-center text-muted-foreground p-4 border border-dashed rounded-lg">
                    <p>No servers available.</p>
                </div>
              ) : (
                <div className="border rounded-lg">
                  {servers.map((server) => {
                    const isFull = server.playerCount >= server.maxPlayers;
                    return (
                        <div key={server.id} className="flex items-center justify-between p-4 border-b last:border-b-0">
                            <div>
                                <p className="font-semibold text-lg">{server.name}</p>
                                <p className="text-sm text-muted-foreground">{server.region}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Users className="h-4 w-4" />
                                    <span>{server.playerCount} / {server.maxPlayers}</span>
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
