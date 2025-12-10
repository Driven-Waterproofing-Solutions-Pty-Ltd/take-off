import React, { useState, useEffect, useMemo } from 'react';
import { TakeoffItem, ToolType } from '../types';

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

    if (!isOpen || !sourceItem) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50" onClick={onClose}>
            <div className="bg-white p-6 rounded-xl shadow-xl w-96 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold mb-4">Change Item</h3>

                <div className="mb-4">
                    <p className="text-sm text-slate-600 mb-2">
                        Moving {shapeIds.length} shape(s) from:
                    </p>
                    <div className="max-h-24 overflow-y-auto bg-slate-50 rounded-md p-2 space-y-2 border">
                        {sourceItems.map(item => (
                            <div key={item.id} className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                                <span className="text-sm font-medium">{item.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Search items..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div className="flex-1 overflow-y-auto mb-4 border border-slate-100 rounded-md">
                    {filteredItems.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 text-sm">
                            No compatible items found
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredItems.map(item => (
                                <div
                                    key={item.id}
                                    className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between border-l-4 ${selectedItemId === item.id ? 'bg-blue-50 border-blue-500' : 'border-transparent'}`}
                                    onClick={() => setSelectedItemId(item.id)}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                                        <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                                        <span className="text-xs text-slate-500">{item.type}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 mt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleChangeItem}
                        disabled={!selectedItemId}
                        className={`px-4 py-2 text-sm text-white rounded-md transition-colors ${selectedItemId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300 cursor-not-allowed'}`}
                    >
                        Change Item
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChangeItemModal;