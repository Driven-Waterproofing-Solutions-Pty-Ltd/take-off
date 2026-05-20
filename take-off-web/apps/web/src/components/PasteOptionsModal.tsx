import React from 'react';
import { TakeoffItem, ToolType } from '../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paste Options</DialogTitle>
          <DialogDescription>
            You have {clipboardItemCount} item(s) in clipboard. Choose how to paste them:
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Option 1: Paste as new items */}
          <Card className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={onPasteAsNewItems}>
            <CardHeader>
              <CardTitle className="text-base">Create New Takeoff Items</CardTitle>
              <CardDescription>
                Each copied shape will be pasted as a new takeoff item with the same properties as the original.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={(e) => { e.stopPropagation(); onPasteAsNewItems(); }}>
                Paste as New Items
              </Button>
            </CardContent>
          </Card>

          {/* Option 2: Paste to original items */}
          <Card className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={onPasteToOriginal}>
            <CardHeader>
              <CardTitle className="text-base">Paste to Original Takeoff Items</CardTitle>
              <CardDescription>
                Shapes will be pasted back into the takeoff items they were copied from.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); onPasteToOriginal(); }}>
                Paste to Original Items
              </Button>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PasteOptionsModal;