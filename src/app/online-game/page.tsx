'use client'
import Game from '@/components/game/Game';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

function OnlineGame() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const serverId = searchParams.get('server');
  const playerId = searchParams.get('player');

  useEffect(() => {
    if (!serverId || !playerId) {
      // If params are missing, redirect to online lobby
      router.replace('/online');
    }
  }, [serverId, playerId, router]);

  if (!serverId || !playerId) {
    return (
      <div className="flex items-center justify-center min-h-screen text-primary text-xl">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        Redirecting...
      </div>
    );
  }

  return <Game mode="online" serverId={serverId} playerId={playerId} />;
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
