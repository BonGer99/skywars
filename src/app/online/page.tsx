'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

function OnlinePageContent() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const savedName = localStorage.getItem('voxelAcesPlayerName');
    if (savedName) {
      setPlayerName(savedName);
    }
  }, []);

  const handleJoin = () => {
    if (!playerName.trim()) {
      toast({
        title: "Enter your callsign!",
        description: "Please enter a callsign before joining.",
        variant: "destructive",
      });
      return;
    }
    setIsJoining(true);
    localStorage.setItem('voxelAcesPlayerName', playerName.trim());
    router.push(`/online-game?playerName=${encodeURIComponent(playerName)}`);
  };

  return (
    <div className="w-full max-w-lg space-y-8">
      <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-bold font-headline text-primary">Join the Fight</CardTitle>
          <CardDescription>
            Enter your callsign to be matched into an online arena.
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
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                className="text-lg text-center"
              />
            </div>
            <Button 
              size="lg" 
              className="w-full max-w-sm mx-auto flex"
              disabled={isJoining}
              onClick={handleJoin}
            >
              {isJoining ? 'Joining...' : 'Launch'}
            </Button>
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
