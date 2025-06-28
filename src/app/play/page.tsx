
'use client';
import { Suspense } from 'react';
import Game from '@/components/game/Game';
import { Loader2 } from 'lucide-react';

// Using a dynamic import to prevent server-side rendering of the Game component,
// which relies heavily on browser-only APIs like WebGL and window.
import dynamic from 'next/dynamic'
const DynamicGame = dynamic(() => import('@/components/game/Game'), { ssr: false })


export default function PlayPage() {
  return (
    <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen text-primary text-xl">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Loading Game...
        </div>
    }>
      <DynamicGame mode="offline" />
    </Suspense>
  )
}
