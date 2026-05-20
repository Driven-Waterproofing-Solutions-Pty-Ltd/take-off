import React, { useState, useEffect, useMemo } from 'react';
import { TakeoffItem } from '../types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Check, ChevronsUpDown } from "lucide-react"

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
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

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

    // Filter items to only show compatible items (same tool type, different from source)
    const sourceItem = items.find(item => item.id === sourceItemId);
    const compatibleItems = items.filter(item =>
        item.id !== sourceItemId &&
        item.type === sourceItem?.type
    );

    const filteredItems = compatibleItems.sort((a, b) => a.label.localeCompare(b.label));

    const handleChangeItem = () => {
        if (selectedItemId) {
            onChangeItem(selectedItemId);
            onClose();
        }
    };

    // Reset selected item when modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedItemId(null);
        }
    }, [isOpen]);

    const selectedItem = items.find(i => i.id === selectedItemId);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[400px] flex flex-col overflow-visible">
                <DialogHeader>
                    <DialogTitle>Change Item</DialogTitle>
                    <DialogDescription className="sr-only">
                        Select a new item to move the selected shapes to.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-2">
                    <div>
                        <p className="text-sm text-muted-foreground mb-2">
                            Moving {shapeIds.length} shape(s) from:
                        </p>
                        <ScrollArea className="h-24 rounded-md border p-2 bg-muted/30">
                            {sourceItems.map(item => (
                                <div key={item.id} className="flex items-center gap-2 py-1 min-w-0">
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                                    <span className="text-sm font-medium truncate" title={item.label}>{item.label}</span>
                                </div>
                            ))}
                        </ScrollArea>
                    </div>

                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium">To item:</span>
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={open}
                                    className="w-full justify-between"
                                >
                                    {selectedItem ? (
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selectedItem.color }}></div>
                                            <span className="truncate">{selectedItem.label}</span>
                                        </div>
                                    ) : (
                                        "Select item..."
                                    )}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[350px] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Search item..." />
                                    <CommandList>
                                        <CommandEmpty>No item found.</CommandEmpty>
                                        <CommandGroup>
                                            {filteredItems.map(item => (
                                                <CommandItem
                                                    key={item.id}
                                                    value={item.label}
                                                    onSelect={() => {
                                                        setSelectedItemId(item.id);
                                                        setOpen(false);
                                                    }}
                                                >
                                                    <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            selectedItemId === item.id ? "opacity-100" : "opacity-0"
                                                        )}
                                                    />
                                                    <div className="flex items-center gap-2 flex-1 overflow-hidden">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                                                        <span className="truncate">{item.label}</span>
                                                        <span className="text-xs text-muted-foreground ml-auto capitalize">{item.type}</span>
                                                    </div>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>

                <DialogFooter className="mt-4">
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