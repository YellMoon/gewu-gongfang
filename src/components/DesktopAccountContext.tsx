import React, { createContext } from 'react';

export const DesktopAccountContext = createContext<{
  controls: React.ReactNode;
  activeRole?: string;
  userId?: string;
  name?: string;
}>({ controls: null });
