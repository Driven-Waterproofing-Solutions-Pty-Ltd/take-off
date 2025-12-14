import React, { useState, useEffect, useMemo } from 'react';
import { TakeoffItem, ToolType } from '../types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface ChangeItemModalProps {
    isOpen: boolean;
    onClose: () => void;
    onChangeItem: (targetItemId: string) => void;
    items: TakeoffItem[];
    sourceItemId: string;
    shapeIds: string[];
}

const ChangeItemModal: React.FC<ChangeItemModalProps> = ({
    isOpen,
    onClose,
    onChangeItem,
    items,
    sourceItemId,
    shapeIds
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

    const sourceItems = useMemo(() => {
        const sourceItemIds = new Set<string>();
        shapeIds.forEach(shapeId => {
            const item = items.find(i => i.shapes.some(s => s.id === shapeId));
            if (item) {
                sourceItemIds.add(item.id);
            }
        });
        return Array.from(sourceItemIds).map(id => items.find(i => i.id === id)).filter(Boolean) as TakeoffItem[];
    }, [items, shapeIds]);

    const sourceItem = items.find(item => item.id === sourceItemId);

    // Filter items to only show compatible items (same tool type, different from source)
    const compatibleItems = items.filter(item =>
        item.id !== sourceItemId &&
        item.type === sourceItem?.type
    );

    // Filter and sort items based on search term
    const filteredItems = compatibleItems
        .filter(item =>
            item.label.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => a.label.localeCompare(b.label));

    const handleChangeItem = () => {
        if (selectedItemId) {
            onChangeItem(selectedItemId);
            onClose();
        }
    };

    useEffect(() => {
        if (isOpen && filteredItems.length > 0) {
            setSelectedItemId(filteredItems[0].id);
        }
    }, [isOpen, filteredItems]);

    // if (!isOpen || !sourceItem) return null; // Dialog handles visibility

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[400px] flex flex-col max-h-[80vh]">
                <DialogHeader>
                    <DialogTitle>Change Item</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 flex-1 flex flex-col min-h-0">
                    <div>
                        <p className="text-sm text-muted-foreground mb-2">
                            Moving {shapeIds.length} shape(s) from:
                        </p>
                        <ScrollArea className="h-24 rounded-md border p-2 bg-muted/30">
                            {sourceItems.map(item => (
                                <div key={item.id} className="flex items-center gap-2 py-1">
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                                    <span className="text-sm font-medium">{item.label}</span>
                                </div>
                            ))}
                        </ScrollArea>
                    </div>

                    <div>
                        <Input
                            type="text"
                            placeholder="Search items..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <ScrollArea className="flex-1 border rounded-md">
                        {filteredItems.length === 0 ? (
                            <div className="p-4 text-center text-muted-foreground text-sm">
                                No compatible items found
                            </div>
                        ) : (
                            <div className="p-1 space-y-1">
                                {filteredItems.map(item => (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "p-3 cursor-pointer rounded-md flex items-center justify-between transition-colors",
                                            selectedItemId === item.id
                                                ? "bg-accent text-accent-foreground"
                                                : "hover:bg-muted"
                                        )}
                                        onClick={() => setSelectedItemId(item.id)}
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                                            <span className="text-sm font-medium truncate">{item.label}</span>
                                            <span className="text-xs text-muted-foreground ml-2 capitalize">{item.type}</span>
                                        </div>
                                        {selectedItemId === item.id && (
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleChangeItem}
                        disabled={!selectedItemId}
                    >
                        Change Item
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ChangeItemModal;