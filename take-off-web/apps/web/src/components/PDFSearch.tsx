import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { mupdfController, DocumentSearchResult, PageSearchResult, SearchHit } from '@/utils/mupdfController';

interface PDFSearchProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigateToPage: (pageIndex: number) => void;
    currentPageIndex: number;
    onHighlightsChange?: (hits: SearchHit[]) => void;
    onCurrentHitChange?: (index: number | null) => void;
}

const PDFSearch: React.FC<PDFSearchProps> = ({
    isOpen,
    onClose,
    onNavigateToPage,
    currentPageIndex,
    onHighlightsChange,
    onCurrentHitChange,
}) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<DocumentSearchResult | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedResultIndex, setSelectedResultIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    // Clear on close
    useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setResults(null);
            setSelectedResultIndex(0);
            // Clear highlights when search is closed
            onHighlightsChange?.([]);
            onCurrentHitChange?.(null);
        }
    }, [isOpen, onHighlightsChange, onCurrentHitChange]);

    // Debounced search
    const performSearch = useCallback((searchQuery: string) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        if (!searchQuery.trim() || searchQuery.length < 2) {
            setResults(null);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);

        debounceRef.current = setTimeout(() => {
            const searchResults = mupdfController.searchDocument(searchQuery);
            setResults(searchResults);
            setIsSearching(false);
            setSelectedResultIndex(0);
            // Emit highlights for current page
            const currentPageHits = searchResults.pages.find(p => p.pageIndex === currentPageIndex)?.hits || [];
            onHighlightsChange?.(currentPageHits);
            onCurrentHitChange?.(0);
        }, 300);
    }, []);

    // Handle input change
    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        performSearch(newQuery);
    };

    // Navigate between results
    const navigateResult = (direction: 'next' | 'prev') => {
        if (!results || results.pages.length === 0) return;

        const totalResults = results.pages.reduce((sum, p) => sum + p.hits.length, 0);
        if (totalResults === 0) return;

        setSelectedResultIndex(prev => {
            if (direction === 'next') {
                return (prev + 1) % totalResults;
            } else {
                return prev === 0 ? totalResults - 1 : prev - 1;
            }
        });
    };

    // Get result at selected index
    const getSelectedResult = (): { pageIndex: number, hitIndex: number } | null => {
        if (!results || results.pages.length === 0) return null;

        let idx = selectedResultIndex;
        for (const page of results.pages) {
            if (idx < page.hits.length) {
                return { pageIndex: page.pageIndex, hitIndex: idx };
            }
            idx -= page.hits.length;
        }
        return null;
    };

    // Navigate to selected result and update highlights
    useEffect(() => {
        const selected = getSelectedResult();
        if (selected) {
            if (selected.pageIndex !== currentPageIndex) {
                onNavigateToPage(selected.pageIndex);
            }
            // Update current hit index for highlighting
            onCurrentHitChange?.(selected.hitIndex);
        }
    }, [selectedResultIndex]);

    // Update highlights when page changes (e.g., manual navigation)
    useEffect(() => {
        if (results) {
            const currentPageHits = results.pages.find(p => p.pageIndex === currentPageIndex)?.hits || [];
            onHighlightsChange?.(currentPageHits);
            // Reset current hit when page changes manually
            const selected = getSelectedResult();
            if (selected?.pageIndex === currentPageIndex) {
                onCurrentHitChange?.(selected.hitIndex);
            } else {
                onCurrentHitChange?.(null);
            }
        }
    }, [currentPageIndex, results, onHighlightsChange, onCurrentHitChange]);

    // Keyboard shortcuts
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
        } else if (e.key === 'Enter') {
            if (e.shiftKey) {
                navigateResult('prev');
            } else {
                navigateResult('next');
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateResult('next');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateResult('prev');
        }
    };

    if (!isOpen) return null;

    const totalHits = results?.totalHits ?? 0;
    const currentResultNum = totalHits > 0 ? selectedResultIndex + 1 : 0;

    return (
        <div className="absolute top-2 right-2 z-50 w-80 bg-background border border-border rounded-lg shadow-xl animate-in slide-in-from-top-2 fade-in duration-200">
            {/* Search Input */}
            <div className="flex items-center gap-2 p-2 border-b border-border">
                <Search size={16} className="text-muted-foreground shrink-0" />
                <Input
                    ref={inputRef}
                    value={query}
                    onChange={handleQueryChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Search in document..."
                    className="h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
                />
                {isSearching && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onClose}>
                    <X size={14} />
                </Button>
            </div>

            {/* Results Summary */}
            {results && (
                <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                        {totalHits === 0 ? (
                            'No results found'
                        ) : (
                            <>
                                <span className="font-medium text-foreground">{currentResultNum}</span>
                                {' of '}
                                <span className="font-medium text-foreground">{totalHits}</span>
                                {' matches'}
                            </>
                        )}
                    </span>
                    {totalHits > 0 && (
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => navigateResult('prev')}
                            >
                                <ChevronUp size={14} />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => navigateResult('next')}
                            >
                                <ChevronDown size={14} />
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Results List */}
            {results && results.pages.length > 0 && (
                <ScrollArea className="max-h-64">
                    <div className="p-2 space-y-1">
                        {results.pages.map((page) => {
                            const isCurrentPage = page.pageIndex === currentPageIndex;
                            return (
                                <div
                                    key={page.pageIndex}
                                    className={`flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors ${isCurrentPage
                                        ? 'bg-primary/10 text-primary'
                                        : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                                        }`}
                                    onClick={() => onNavigateToPage(page.pageIndex)}
                                >
                                    <span className="text-sm">Page {page.pageIndex + 1}</span>
                                    <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
                                        {page.hits.length} {page.hits.length === 1 ? 'match' : 'matches'}
                                    </Badge>
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            )}

            {/* Help Text */}
            <div className="px-3 py-2 border-t border-border bg-muted/20">
                <span className="text-[10px] text-muted-foreground">
                    Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> for next,{' '}
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift+Enter</kbd> for previous
                </span>
            </div>
        </div>
    );
};

export default PDFSearch;
