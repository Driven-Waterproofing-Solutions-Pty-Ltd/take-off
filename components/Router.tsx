import React, { useState, createContext, useContext, ReactNode } from 'react';

type ViewMode = 'canvas' | 'estimates' | '3d';

interface RouterContextType {
  viewMode: ViewMode;
  setViewMode: (viewMode: ViewMode) => void;
  // Off-canvas sidebar drawer state (mobile only; ignored on desktop where the
  // sidebar is always statically visible).
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const RouterContext = createContext<RouterContextType | undefined>(undefined);

export const RouterProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <RouterContext.Provider value={{ viewMode, setViewMode, sidebarOpen, setSidebarOpen }}>
      {children}
    </RouterContext.Provider>
  );
};

export const useViewRouter = () => {
  const context = useContext(RouterContext);
  if (context === undefined) {
    throw new Error('useViewRouter must be used within a RouterProvider');
  }
  return context;
};
