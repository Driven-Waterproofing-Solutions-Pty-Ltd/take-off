import React from 'react';
import { TakeoffItem, ToolType } from '../types';

interface PasteOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasteToOriginal: () => void;
  onPasteAsNewItems: () => void;
  items: TakeoffItem[];
  clipboardItemCount: number;
}

const PasteOptionsModal: React.FC<PasteOptionsModalProps> = ({
  isOpen,
  onClose,
  onPasteToOriginal,
  onPasteAsNewItems,
  items,
  clipboardItemCount
}) => {
  if (!isOpen) return null;

  // Group items by type for better organization
  const itemsByType = items.reduce((acc, item) => {
    if (!acc[item.type]) {
      acc[item.type] = [];
    }
    acc[item.type].push(item);
    return acc;
  }, {} as Record<ToolType, TakeoffItem[]>);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-slate-800 mb-4">Paste Options</h3>
        <p className="text-slate-600 mb-6">
          You have {clipboardItemCount} item(s) in clipboard. Choose how to paste them:
        </p>

        <div className="space-y-6">
          {/* Option 1: Paste as new items */}
          <div className="border border-slate-200 rounded-lg p-4">
            <h4 className="font-semibold text-slate-700 mb-3">Create New Takeoff Items</h4>
            <p className="text-slate-600 text-sm mb-4">
              Each copied shape will be pasted as a new takeoff item with the same properties as the original.
            </p>
            <button
              onClick={onPasteAsNewItems}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Paste as New Items
            </button>
          </div>

          {/* Option 2: Paste to original items */}
          <div className="border border-slate-200 rounded-lg p-4">
            <h4 className="font-semibold text-slate-700 mb-3">Paste to Original Takeoff Items</h4>
            <p className="text-slate-600 text-sm mb-4">
              Shapes will be pasted back into the takeoff items they were copied from.
            </p>
            <button
              onClick={onPasteToOriginal}
              className="w-full bg-white border border-slate-300 text-slate-700 py-2 px-4 rounded-lg hover:bg-slate-50 transition-colors font-medium"
            >
              Paste to Original Items
            </button>
          </div>
        </div>

        <div className="flex justify-end mt-6 gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default PasteOptionsModal;