import { useEffect } from 'react';
import { ToolType } from '../types';

interface UseKeyboardShortcutsProps {
    undo: () => void;
    redo: () => void;
    setTool: (tool: ToolType) => void;
    toggleDeductionMode: () => void;
    deleteSelectedItem: () => void;
    cancelAction: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    saveProject: () => void;
    nextPage: () => void;
    prevPage: () => void;
    zoomToFit: () => void;
    toggleRecord: () => void;
    toggleViewMode: () => void;
    finishShape: () => void;
    copyItem: () => void;
    pasteItem: () => void;
}

export const useKeyboardShortcuts = ({
    undo,
    redo,
    setTool,
    toggleDeductionMode,
    deleteSelectedItem,
    cancelAction,
    zoomIn,
    zoomOut,
    saveProject,
    nextPage,
    prevPage,
    zoomToFit,
    toggleRecord,
    toggleViewMode,
    finishShape,
    copyItem,
    pasteItem,
}: UseKeyboardShortcutsProps) => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Ignore if user is typing in an input or textarea
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            if (event.defaultPrevented) return;

            const key = event.key.toLowerCase();
            const isCtrlOrCmd = event.metaKey || event.ctrlKey;

            // --- Global Actions ---

            // Save (Cmd+S / Ctrl+S)
            if (isCtrlOrCmd && key === 's') {
                event.preventDefault();
                saveProject();
                return;
            }

            // Undo / Redo
            if (isCtrlOrCmd && key === 'z') {
                event.preventDefault();
                if (event.shiftKey) {
                    redo();
                } else {
                    undo();
                }
                return;
            }
            // Redo (Windows style Ctrl+Y)
            if (isCtrlOrCmd && key === 'y') {
                event.preventDefault();
                redo();
                return;
            }

            // Copy (Cmd+C / Ctrl+C)
            if (isCtrlOrCmd && key === 'c') {
                event.preventDefault();
                copyItem();
                return;
            }

            // Paste (Cmd+V / Ctrl+V)
            if (isCtrlOrCmd && key === 'v') {
                event.preventDefault();
                pasteItem();
                return;
            }

            // --- Navigation ---

            // Page Navigation
            if (event.key === 'PageDown') {
                event.preventDefault();
                nextPage();
                return;
            }
            if (event.key === 'PageUp') {
                event.preventDefault();
                prevPage();
                return;
            }

            // Zoom
            if (event.key === '=' || event.key === '+' || event.key === 'Add') { // Add is Numpad +
                event.preventDefault();
                zoomIn();
                return;
            }
            if (event.key === '-' || event.key === '_' || event.key === 'Subtract') { // Subtract is Numpad -
                event.preventDefault();
                zoomOut();
                return;
            }
            if (event.key === 'F7') {
                event.preventDefault();
                zoomToFit();
                return;
            }

            // View Toggle
            if (event.key === 'F12') {
                event.preventDefault();
                toggleViewMode();
                return;
            }

            // --- Tools & Editing ---

            // PlanSwift Tool Mapping
            switch (key) {
                case '1':
                    setTool(ToolType.AREA);
                    break;
                case '2':
                    setTool(ToolType.LINEAR);
                    break;
                case '3':
                    setTool(ToolType.SEGMENT);
                    break;
                case '4':
                    setTool(ToolType.COUNT);
                    break;
                case '5': // PlanSwift Note (Custom mapping to 5)
                    setTool(ToolType.NOTE);
                    break;
                case 'c': // Close Shape
                    finishShape();
                    break;
                case 'r': // Toggle Recording
                    toggleRecord();
                    break;

                // Legacy / Mac / Common Fallbacks
                case 'v':
                    setTool(ToolType.SELECT);
                    break;
                case 's':
                    setTool(ToolType.SCALE);
                    break;
                case 'd':
                    setTool(ToolType.DIMENSION);
                    break;
                case 'x':
                    toggleDeductionMode();
                    break;
                case 'escape':
                    cancelAction();
                    break;
                case 'backspace':
                case 'delete':
                    deleteSelectedItem();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [
        undo, redo, setTool, toggleDeductionMode, deleteSelectedItem, cancelAction,
        zoomIn, zoomOut, saveProject, nextPage, prevPage, zoomToFit,
        toggleRecord, toggleViewMode, finishShape, copyItem, pasteItem
    ]);
};
