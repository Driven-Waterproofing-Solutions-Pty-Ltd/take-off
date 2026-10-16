import React, { useState } from 'react';
import { ToolType } from '../types';
import { generateColor } from '../utils/geometry';
import { Tag } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface NewTemplateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNext: (name: string, type: ToolType, color: string) => void;
}

const NewTemplateModal: React.FC<NewTemplateModalProps> = ({ isOpen, onClose, onNext }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<ToolType>(ToolType.AREA);
    const [color, setColor] = useState(generateColor(0));

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (name.trim()) {
            onNext(name.trim(), type, color);
            // Reset form
            setName('');
            setType(ToolType.AREA);
            setColor(generateColor(0));
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Tag className="w-5 h-5" /> New Template
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="name">Template Name</Label>
                        <Input
                            id="name"
                            autoFocus
                            placeholder="e.g. 2x4 Wall"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Tool Type</Label>
                        <Select value={type} onValueChange={(val) => setType(val as ToolType)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select tool type" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(ToolType).map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {t}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Default Color</Label>
                        <div className="flex gap-2 flex-wrap">
                            {[
                                '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
                                '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
                            ].map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    className={cn(
                                        "w-8 h-8 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                        color === c ? "border-foreground scale-110 shadow-md" : "border-transparent hover:scale-105"
                                    )}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={!name.trim()}>Next</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NewTemplateModal;
