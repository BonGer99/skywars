'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Leaderboard from '@/components/ui/Leaderboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Copy } from 'lucide-react';
import { useToast } from "@/hooks/use-toast"


export default function OnlinePage() {
  const [playerName, setPlayerName] = useState('');
  const [lobbyCode, setLobbyCode] = useState('');
  const [createdLobbyId, setCreatedLobbyId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCreateLobby = () => {
    if (!playerName) {
        toast({
            title: "Error",
            description: "Please enter your callsign before creating a lobby.",
            variant: "destructive",
        });
        return;
    }
    const newLobbyId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setCreatedLobbyId(newLobbyId);
    toast({
        title: "Lobby Created!",
        description: `Your lobby code is ${newLobbyId}. Share it with your friends!`,
    });
  };

  const handleJoinLobby = () => {
     if (!playerName) {
        toast({
            title: "Error",
            description: "Please enter your callsign before joining a lobby.",
            variant: "destructive",
        });
        return;
    }
    if (!lobbyCode) {
        toast({
            title: "Error",
            description: "Please enter a lobby code to join.",
            variant: "destructive",
        });
        return;
    }
    // Mock joining logic
    toast({
        title: "Joining Lobby...",
        description: `Attempting to join lobby ${lobbyCode} as ${playerName}.`,
    });
     // In a real implementation, you would navigate to the game/lobby page here.
  };

  const copyLobbyId = () => {
    if(createdLobbyId) {
        navigator.clipboard.writeText(createdLobbyId);
        toast({
            title: "Copied!",
            description: "Lobby code copied to clipboard.",
        });
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 sm:p-24 bg-background">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl">
          <CardHeader>
            <CardTitle className="text-4xl font-bold font-headline text-primary">Join the Fight</CardTitle>
            <CardDescription>
              Enter your callsign and create or join a private lobby.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="playerName">Your Callsign</Label>
              <Input 
                id="playerName" 
                placeholder="AcePilot_1" 
                value={playerName} 
                onChange={(e) => setPlayerName(e.target.value)} 
                className="text-lg"
              />
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Create a New Lobby</h3>
              <Button size="lg" className="w-full" onClick={handleCreateLobby}>
                Create Private Lobby
              </Button>
              {createdLobbyId && (
                <div className="p-3 bg-muted rounded-md flex items-center justify-between">
                    <p className="text-sm">
                        Lobby Code: <span className="font-bold text-accent">{createdLobbyId}</span>
                    </p>
                    <Button variant="ghost" size="icon" onClick={copyLobbyId}>
                        <Copy className="h-4 w-4" />
                    </Button>
                </div>
              )}
            </div>

            <Separator />
            
             <div className="space-y-4">
                <h3 className="font-semibold text-lg">Join an Existing Lobby</h3>
                <div className="space-y-2">
                    <Label htmlFor="lobbyCode">Lobby Code</Label>
                    <Input 
                        id="lobbyCode" 
                        placeholder="ABC123" 
                        value={lobbyCode} 
                        onChange={(e) => setLobbyCode(e.target.value.toUpperCase())}
                        className="text-lg"
                    />
                </div>
                <Button size="lg" variant="secondary" className="w-full" onClick={handleJoinLobby}>
                    Join Lobby
                </Button>
            </div>
             <Separator />
             <Link href="/" passHref className="w-full block">
                <Button size="lg" variant="outline" className="w-full text-lg py-6">
                    <ArrowLeft className="mr-2 h-6 w-6" />
                    Back to Menu
                </Button>
             </Link>
          </CardContent>
        </Card>

        <div className="flex flex-col">
            <Leaderboard />
        </div>
      </div>
    </main>
  );
}
