import React, { useState, useEffect, useRef } from 'react';
import { Save, X } from 'lucide-react';

interface NoteInputModalProps {
    isOpen: boolean;
    initialText: string;
    onSave: (text: string) => void;
    onClose: () => void;
}

const NoteInputModal: React.FC<NoteInputModalProps> = ({ isOpen, initialText, onSave, onClose }) => {
    const [text, setText] = useState(initialText);
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
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-[400px] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800">Edit Note</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4">
                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter note text..."
                        className="w-full h-32 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none resize-none text-slate-700"
                    />
                    <div className="mt-2 text-xs text-slate-400 text-right">
                        Press Enter to save, Shift+Enter for new line
                    </div>
                </div>

                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm flex items-center gap-2 transition-colors"
                    >
                        <Save size={16} /> Save Note
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NoteInputModal;
