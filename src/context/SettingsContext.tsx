'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface SettingsContextType {
  onScreenControls: boolean;
  setOnScreenControls: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [onScreenControls, setOnScreenControlsState] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // This effect runs only once on the client to initialize from localStorage or device type
    const storedValue = localStorage.getItem('onScreenControls');
    if (storedValue !== null) {
      setOnScreenControlsState(JSON.parse(storedValue));
    } else {
      setOnScreenControlsState(isMobile);
    }
    setIsInitialized(true);
  }, [isMobile]);

  const setOnScreenControls = (value: boolean) => {
    setOnScreenControlsState(value);
    if (typeof window !== 'undefined') {
        localStorage.setItem('onScreenControls', JSON.stringify(value));
    }
  };

  // This effect ensures that if the state is changed programmatically, it's saved.
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('onScreenControls', JSON.stringify(onScreenControls));
    }
  }, [onScreenControls, isInitialized]);


  const value = { onScreenControls, setOnScreenControls };

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
