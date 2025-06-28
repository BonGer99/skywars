
'use client';
import { Suspense } from 'react';
import Game from '@/components/game/Game';
import { Loader2 } from 'lucide-react';

export default function PlayPage() {
  return (
    <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen text-primary text-xl">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Loading Game...
        </div>
    }>
      <Game mode="offline" />
    </Suspense>
  );
}
