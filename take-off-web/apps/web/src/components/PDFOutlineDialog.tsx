import React, { useState, useEffect } from 'react';
import { FileText, Book, ChevronRight, ChevronDown, Info, Calendar, User } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { mupdfController, OutlineItem, DocumentMetadata } from '@/utils/mupdfController';

interface PDFOutlineProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigateToPage: (pageIndex: number) => void;
    currentPageIndex: number;
}

const OutlineNode: React.FC<{
    item: OutlineItem;
    level: number;
    onNavigate: (page: number) => void;
    currentPage: number;
}> = ({ item, level, onNavigate, currentPage }) => {
    const [isOpen, setIsOpen] = useState(level === 0);
    const hasChildren = item.children && item.children.length > 0;
    const isActive = item.page === currentPage;

    return (
        <div>
            <div
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/50 text-foreground'
                    }`}
                style={{ paddingLeft: `${8 + level * 16}px` }}
                onClick={() => {
                    if (item.page >= 0) {
                        onNavigate(item.page);
                    }
                }}
            >
                {hasChildren && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 p-0 shrink-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(!isOpen);
                        }}
                    >
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </Button>
                )}
                {!hasChildren && <div className="w-4" />}
                <span className="text-sm truncate flex-1">{item.title}</span>
                {item.page >= 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 h-4 shrink-0">
                        {item.page + 1}
                    </Badge>
                )}
            </div>
            {hasChildren && isOpen && (
                <div className="ml-2 border-l border-border/50">
                    {item.children!.map((child, idx) => (
                        <OutlineNode
                            key={idx}
                            item={child}
                            level={level + 1}
                            onNavigate={onNavigate}
                            currentPage={currentPage}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const PDFOutlineDialog: React.FC<PDFOutlineProps> = ({
    isOpen,
    onClose,
    onNavigateToPage,
    currentPageIndex,
}) => {
    const [outline, setOutline] = useState<OutlineItem[] | null>(null);
    const [metadata, setMetadata] = useState<DocumentMetadata>({});
    const [activeTab, setActiveTab] = useState<'outline' | 'info'>('outline');

    // Load outline and metadata when dialog opens
    useEffect(() => {
        if (isOpen && mupdfController.isDocumentLoaded()) {
            setOutline(mupdfController.getOutline());
            setMetadata(mupdfController.getMetadata());
        }
    }, [isOpen]);

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return null;
        // PDF dates are in format: D:YYYYMMDDHHmmSS
        const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
        if (match) {
            const [, year, month, day, hour, min, sec] = match;
            const date = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour || '0'),
                parseInt(min || '0'),
                parseInt(sec || '0')
            );
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        }
        return dateStr;
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Book size={18} />
                        Document Info
                    </DialogTitle>
                    <DialogDescription>
                        View document outline, bookmarks, and metadata
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <div className="flex gap-2 border-b border-border pb-2">
                    <Button
                        variant={activeTab === 'outline' ? 'default' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setActiveTab('outline')}
                    >
                        <Book size={12} className="mr-1" />
                        Outline
                    </Button>
                    <Button
                        variant={activeTab === 'info' ? 'default' : 'ghost'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setActiveTab('info')}
                    >
                        <Info size={12} className="mr-1" />
                        Properties
                    </Button>
                </div>

                {/* Content */}
                <ScrollArea className="flex-1 -mx-6 px-6">
                    {activeTab === 'outline' && (
                        <div className="space-y-1 py-2">
                            {outline && outline.length > 0 ? (
                                outline.map((item, idx) => (
                                    <OutlineNode
                                        key={idx}
                                        item={item}
                                        level={0}
                                        onNavigate={(page) => {
                                            onNavigateToPage(page);
                                            onClose();
                                        }}
                                        currentPage={currentPageIndex}
                                    />
                                ))
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <FileText size={32} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No outline available</p>
                                    <p className="text-xs mt-1">This PDF doesn't contain bookmarks</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'info' && (
                        <div className="space-y-3 py-2">
                            {metadata.title && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Title</div>
                                    <div className="text-sm font-medium">{metadata.title}</div>
                                </div>
                            )}

                            {metadata.author && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Author</div>
                                    <div className="text-sm flex items-center gap-2">
                                        <User size={14} className="text-muted-foreground" />
                                        {metadata.author}
                                    </div>
                                </div>
                            )}

                            {metadata.subject && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Subject</div>
                                    <div className="text-sm">{metadata.subject}</div>
                                </div>
                            )}

                            {metadata.keywords && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Keywords</div>
                                    <div className="flex flex-wrap gap-1">
                                        {metadata.keywords.split(/[,;]/).map((kw, i) => (
                                            <Badge key={i} variant="secondary" className="text-xs">
                                                {kw.trim()}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Separator />

                            <div className="grid grid-cols-2 gap-3">
                                {metadata.creationDate && (
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Created</div>
                                        <div className="text-sm flex items-center gap-2">
                                            <Calendar size={14} className="text-muted-foreground" />
                                            {formatDate(metadata.creationDate)}
                                        </div>
                                    </div>
                                )}

                                {metadata.modDate && (
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Modified</div>
                                        <div className="text-sm flex items-center gap-2">
                                            <Calendar size={14} className="text-muted-foreground" />
                                            {formatDate(metadata.modDate)}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <Separator />

                            {metadata.creator && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Creator</div>
                                    <div className="text-sm text-muted-foreground">{metadata.creator}</div>
                                </div>
                            )}

                            {metadata.producer && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Producer</div>
                                    <div className="text-sm text-muted-foreground">{metadata.producer}</div>
                                </div>
                            )}

                            {metadata.format && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Format</div>
                                    <div className="text-sm text-muted-foreground">{metadata.format}</div>
                                </div>
                            )}

                            {!metadata.title && !metadata.author && !metadata.creationDate && (
                                <div className="text-center py-4 text-muted-foreground">
                                    <Info size={32} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No metadata available</p>
                                </div>
                            )}
                        </div>
                    )}
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};

export default PDFOutlineDialog;
