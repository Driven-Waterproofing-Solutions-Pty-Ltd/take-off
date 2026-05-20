import React, { useState, useEffect, useRef } from 'react';
import { Save } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

interface NoteInputModalProps {
    isOpen: boolean;
    initialText: string;
    onSave: (text: string) => void;
    onClose: () => void;
}

const NoteInputModal: React.FC<NoteInputModalProps> = ({ isOpen, initialText, onSave, onClose }) => {
    const [text, setText] = useState(initialText);
    // Use React.ComponentProps type for Textarea if needed, but standard HTMLTextAreaElement ref works with shadcn Textarea
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen) {
            setText(initialText);
            // Focus after a short delay to ensure modal is rendered
            setTimeout(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                    textareaRef.current.select();
                }
            }, 50);
        }
    }, [isOpen, initialText]);

    const handleSave = () => {
        if (text.trim()) {
            onSave(text.trim());
        }
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        }
        // Dialog handles Escape automatically
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit Note</DialogTitle>
                </DialogHeader>

                <div className="py-2">
                    <Textarea
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter note text..."
                        className="min-h-[150px] resize-none"
                    />
                    <div className="mt-2 text-xs text-muted-foreground text-right">
                        Press Enter to save, Shift+Enter for new line
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} className="gap-2">
                        <Save className="w-4 h-4" /> Save Note
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NoteInputModal;
