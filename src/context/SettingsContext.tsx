'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-is-mobile';

type ControlStyle = 'realistic' | 'arcade';

interface SettingsContextType {
  onScreenControls: boolean;
  setOnScreenControls: (value: boolean) => void;
  controlStyle: ControlStyle;
  setControlStyle: (value: ControlStyle) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [onScreenControls, setOnScreenControlsState] = useState(false);
  const [controlStyle, setControlStyleState] = useState<ControlStyle>('realistic');
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // This effect runs only once on the client to initialize from localStorage or device type
    const storedOnScreenControls = localStorage.getItem('onScreenControls');
    if (storedOnScreenControls !== null) {
      setOnScreenControlsState(JSON.parse(storedOnScreenControls));
    } else {
      setOnScreenControlsState(isMobile);
    }

    const storedControlStyle = localStorage.getItem('controlStyle');
    if (storedControlStyle) {
      setControlStyleState(storedControlStyle as ControlStyle);
    }

    setIsInitialized(true);
  }, [isMobile]);

  const setOnScreenControls = (value: boolean) => {
    setOnScreenControlsState(value);
    localStorage.setItem('onScreenControls', JSON.stringify(value));
  };

  const setControlStyle = (value: ControlStyle) => {
    setControlStyleState(value);
    localStorage.setItem('controlStyle', value);
  };
  
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('onScreenControls', JSON.stringify(onScreenControls));
      localStorage.setItem('controlStyle', controlStyle);
    }
  }, [onScreenControls, controlStyle, isInitialized]);


  const value = { onScreenControls, setOnScreenControls, controlStyle, setControlStyle };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
