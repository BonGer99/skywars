import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Leaderboard from '@/components/ui/Leaderboard';
import { ArrowLeft } from 'lucide-react';

export default function OnlinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 sm:p-24 bg-background">
      <Card className="w-full max-w-2xl bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl">
        <CardHeader>
          <CardTitle className="text-4xl font-bold font-headline text-primary text-center">Online Multiplayer</CardTitle>
          <CardDescription className="text-center">
            Climb the ranks and become the top ace!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Leaderboard />
          <div className="flex flex-col sm:flex-row gap-4">
             <Button size="lg" className="w-full text-lg py-6" disabled>
                Join Global Dogfight (Coming Soon)
             </Button>
             <Link href="/" passHref className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full text-lg py-6">
                    <ArrowLeft className="mr-2 h-6 w-6" />
                    Back to Menu
                </Button>
             </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
