
'use client'
import Game from '@/components/game/Game';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

function OnlineGame() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const playerName = searchParams.get('playerName');

  useEffect(() => {
    if (!playerName) {
      router.replace('/online');
    }
  }, [playerName, router]);

  if (!playerName) {
    return (
      <div className="flex items-center justify-center min-h-screen text-primary text-xl">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        Redirecting...
      </div>
    );
  }

  // The serverId is no longer needed as Colyseus handles room management.
  return <Game mode="online" playerName={playerName} />;
}


export default function OnlineGamePage() {
  return (
    <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen text-primary text-xl">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Loading Game...
        </div>
    }>
        <OnlineGame />
    </Suspense>
  );
}
