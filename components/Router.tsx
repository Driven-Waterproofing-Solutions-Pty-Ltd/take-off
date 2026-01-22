import React, { useState, createContext, useContext, ReactNode } from 'react';

type ViewMode = 'canvas' | 'estimates' | '3d';

interface RouterContextType {
  viewMode: ViewMode;
  setViewMode: (viewMode: ViewMode) => void;
}

const RouterContext = createContext<RouterContextType | undefined>(undefined);

export const RouterProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');

  return (
    <RouterContext.Provider value={{ viewMode, setViewMode }}>
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