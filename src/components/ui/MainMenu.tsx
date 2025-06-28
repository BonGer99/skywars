'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlaneTakeoff, Settings, Users, Gamepad2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSettings } from '@/context/SettingsContext';


const HangarIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
        <line x1="12" y1="22.08" x2="12" y2="12"></line>
    </svg>
);


export default function MainMenu() {
  const { onScreenControls, setOnScreenControls } = useSettings();

  return (
    <div className="text-center">
      <h1 className="text-6xl md:text-8xl font-headline font-bold text-primary mb-4 drop-shadow-lg">
        Voxel Aces
      </h1>
      <p className="text-lg md:text-xl text-foreground/80 mb-12 max-w-2xl mx-auto">
        Take to the skies in blocky, high-octane dogfights. Choose a mode below to begin your adventure.
      </p>
      <Card className="max-w-md mx-auto bg-card/80 backdrop-blur-sm border-primary/20 shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-3xl font-headline text-primary">Main Menu</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Link href="/play" passHref>
            <Button className="w-full text-lg py-6" size="lg">
              <PlaneTakeoff className="mr-2 h-6 w-6" />
              Play Offline
            </Button>
          </Link>
          <Link href="/online" passHref>
            <Button className="w-full text-lg py-6" size="lg" variant="secondary">
              <Users className="mr-2 h-6 w-6" />
              Play Online
            </Button>
          </Link>
          <Button className="w-full text-lg py-6" size="lg" variant="secondary" disabled>
             <div className="w-6 h-6 mr-2 flex items-center justify-center">
                <HangarIcon />
            </div>
            Hangar
          </Button>
           <Dialog>
            <DialogTrigger asChild>
              <Button className="w-full text-lg py-6" size="lg" variant="secondary">
                <Settings className="mr-2 h-6 w-6" />
                Settings
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Game Settings</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="flex items-center space-x-4 rounded-md border p-4">
                    <Gamepad2 />
                    <div className="flex-1 space-y-1">
                       <Label htmlFor="on-screen-controls" className="text-base">On-Screen Controls</Label>
                        <p className="text-sm text-muted-foreground">
                            Enable virtual joystick and buttons for touch devices.
                        </p>
                    </div>
                    <Switch
                        id="on-screen-controls"
                        checked={onScreenControls}
                        onCheckedChange={setOnScreenControls}
                    />
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
