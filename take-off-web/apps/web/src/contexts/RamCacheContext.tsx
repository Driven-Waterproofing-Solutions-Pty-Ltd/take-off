import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { getPageImage } from '../utils/pdfCache';

interface RamCacheContextType {
    // Returns the blob URL if available in RAM
    getCachedPage: (fileId: string, pageIndex: number) => string | null;
    // Preloads a page into RAM from disk or other sources (if not already loaded)
    preloadPage: (fileId: string, pageIndex: number) => Promise<void>;
    // Clears the entire RAM cache
    clearCache: () => void;
    // Clears a specific page from RAM
    removePage: (fileId: string, pageIndex: number) => void;
}

const RamCacheContext = createContext<RamCacheContextType | null>(null);

export const useRamCache = () => {
    const context = useContext(RamCacheContext);
    if (!context) {
        throw new Error('useRamCache must be used within a RamCacheProvider');
    }
    return context;
};

export const RamCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Map key: `${fileId}_${pageIndex}` -> value: blobUrl
    const cacheRef = useRef<Map<string, string>>(new Map());
    // Force re-render not strictly needed for the cache map content itself if we treat it as an imperative store,
    // but if we want UI to react to cache availability (unlikely for "instant load" which is an imperative check),
    // a ref is better for performance to avoid re-rendering the whole tree on every cache add.
    // However, consumers might want to know if a page IS cached.
    // For "flawless transition", the canvas just checks the ref on mount/update.

    const getCachedPage = (fileId: string, pageIndex: number) => {
        const key = `${fileId}_${pageIndex}`;
        return cacheRef.current.get(key) || null;
    };

    const preloadPage = async (fileId: string, pageIndex: number) => {
        const key = `${fileId}_${pageIndex}`;
        if (cacheRef.current.has(key)) return;

        try {
            // Try to get from disk cache
            const blob = await getPageImage(fileId, pageIndex);
            if (blob) {
                const url = URL.createObjectURL(blob);
                cacheRef.current.set(key, url);
                // console.log(`[RAM Cache] Preloaded ${key}`);
            }
        } catch (e) {
            console.error(`[RAM Cache] Failed to preload ${key}`, e);
        }
    };

    const removePage = (fileId: string, pageIndex: number) => {
        const key = `${fileId}_${pageIndex}`;
        const url = cacheRef.current.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            cacheRef.current.delete(key);
        }
    };

    const clearCache = () => {
        cacheRef.current.forEach(url => URL.revokeObjectURL(url));
        cacheRef.current.clear();
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => clearCache();
    }, []);

    return (
        <RamCacheContext.Provider value={{ getCachedPage, preloadPage, clearCache, removePage }}>
            {children}
        </RamCacheContext.Provider>
    );
};
