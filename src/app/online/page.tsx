'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, doc, addDoc, getDocs, writeBatch, serverTimestamp, runTransaction, where, limit } from 'firebase/firestore';


type Server = {
  id: string;
  name: string;
  region: string;
  players: number;
  maxPlayers: number;
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
  const [playerName, setPlayerName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    seedServers();
  }, []);

  const handleFindMatch = async () => {
    if (!playerName) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining a server.",
        variant: "destructive",
      });
      return;
    }
    setIsJoining(true);

    try {
      const serversCollection = collection(db, 'servers');
      const q = query(serversCollection, where("players", "<", 24), limit(1));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        toast({
            title: "No Available Servers",
            description: "All servers are currently full. Please try again later.",
            variant: "destructive"
        });
        setIsJoining(false);
        return;
      }
      
      const serverDoc = snapshot.docs[0];
      const server = { id: serverDoc.id, ...serverDoc.data() } as Server;

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
      toast({ title: "Error", description: "Could not join a server. Please try again.", variant: "destructive" });
      setIsJoining(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-8">
      <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl text-center">
        <CardHeader>
          <CardTitle className="text-4xl font-bold font-headline text-primary">Find a Match</CardTitle>
          <CardDescription>
            Enter your callsign and jump into the next available dogfight.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <Button size="lg" className="w-full" onClick={handleFindMatch} disabled={isJoining}>
              {isJoining ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Joining...</> : 'Find Match'}
            </Button>
        </CardContent>
         <CardFooter className="flex-col sm:flex-row gap-2">
             <Link href="/" passHref className="w-full sm:w-auto mx-auto block">
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

export default function OnlinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 sm:p-24 bg-background">
        <OnlinePageContent />
    </main>
  );
}
