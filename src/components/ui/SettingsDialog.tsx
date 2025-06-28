'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSettings } from '@/context/SettingsContext';
import { Gamepad2, Mouse } from 'lucide-react';
import type { ReactNode } from 'react';

export function SettingsDialog({ children }: { children: ReactNode }) {
  const {
    onScreenControls,
    setOnScreenControls,
    controlStyle,
    setControlStyle,
  } = useSettings();

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Game Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center space-x-4 rounded-md border p-4">
            <Gamepad2 />
            <div className="flex-1 space-y-1">
              <Label htmlFor="on-screen-controls" className="text-base">
                On-Screen Controls
              </Label>
              <p className="text-sm text-muted-foreground">
                Enable virtual joystick for touch devices.
              </p>
            </div>
            <Switch
              id="on-screen-controls"
              checked={onScreenControls}
              onCheckedChange={setOnScreenControls}
            />
          </div>
          <div className="flex items-center space-x-4 rounded-md border p-4">
            <Mouse />
            <div className="flex-1 space-y-1">
              <Label className="text-base">Desktop Control Style</Label>
              <p className="text-sm text-muted-foreground">
                Choose your preferred flight controls.
              </p>
            </div>
            <RadioGroup
              value={controlStyle}
              onValueChange={(value) => setControlStyle(value as 'realistic' | 'arcade')}
              className="flex flex-col space-y-1"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="realistic" id="r1" />
                <Label htmlFor="r1">Realistic</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="arcade" id="r2" />
                <Label htmlFor="r2">Arcade</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
