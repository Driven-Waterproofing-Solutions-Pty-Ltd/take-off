import React, { useState } from 'react';
import { TakeoffItem, ToolType } from '../types';
import { generateColor } from '../utils/geometry';
import TemplateManager from './TemplateManager';
import { Tag, Edit3 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface NewItemModalProps {
    toolType: ToolType;
    existingCount: number;
    onCreate: (data: Partial<TakeoffItem>) => void;
    onCancel: () => void;
}

const NewItemModal: React.FC<NewItemModalProps> = ({ toolType, existingCount, onCreate, onCancel }) => {
    // Basic Form State
    const [name, setName] = useState(`${toolType.charAt(0) + toolType.slice(1).toLowerCase()} ${existingCount + 1}`);
    const [color, setColor] = useState(generateColor(existingCount));
    const [depthFeet, setDepthFeet] = useState(0);
    const [depthInches, setDepthInches] = useState(0);

    const handleBasicSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            const depth = toolType === ToolType.VOLUME ? (depthFeet + depthInches / 12) : undefined;
            onCreate({ label: name, color, depth });
        }
    };

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent className="sm:max-w-[800px] w-[90vw] p-0 overflow-hidden flex flex-col h-[80vh] max-h-[800px]">
                <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                    <DialogTitle>Create New Item</DialogTitle>
                    <DialogDescription>
                        Create a new takeoff item or select from a template.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="basic" className="w-full flex-1 flex flex-col overflow-hidden">
                    <div className="px-6 pb-2 border-b">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="basic">
                                <Edit3 className="mr-2 h-4 w-4" />
                                Basic
                            </TabsTrigger>
                            <TabsTrigger value="template">
                                <Tag className="mr-2 h-4 w-4" />
                                From Template
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="basic" className="flex-1 p-6 mt-0 overflow-y-auto">
                        <form onSubmit={handleBasicSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    autoFocus
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Color</Label>
                                <div className="flex gap-2 flex-wrap">
                                    {[
                                        '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
                                        '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
                                    ].map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setColor(c)}
                                            className={`w-8 h-8 rounded-md border-2 transition-all ${color === c ? 'border-primary ring-2 ring-primary ring-offset-2' : 'border-transparent hover:border-border'}`}
                                            style={{ backgroundColor: c }}
                                            aria-label={`Select color ${c}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            {toolType === ToolType.VOLUME && (
                                <div className="space-y-2">
                                    <Label>Depth</Label>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <Input
                                                type="number"
                                                placeholder="Feet"
                                                value={depthFeet}
                                                onChange={e => setDepthFeet(Number(e.target.value) || 0)}
                                                min={0}
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <Input
                                                type="number"
                                                placeholder="Inches"
                                                value={depthInches}
                                                onChange={e => setDepthInches(Number(e.target.value) || 0)}
                                                min={0}
                                                max={11}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-4">
                                <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
                                <Button type="submit">Create Item</Button>
                            </div>
                        </form>
                    </TabsContent>

                    <TabsContent value="template" className="flex-1 flex flex-col mt-0 h-full min-h-0">
                        <div className="flex-1 overflow-hidden bg-muted/30">
                            <TemplateManager
                                mode="select"
                                filterToolType={toolType}
                                onSelect={(template) => {
                                    // Map template to item data
                                    onCreate({
                                        label: template.label,
                                        color: template.color,
                                        unit: template.unit,
                                        properties: template.properties,
                                        formula: template.formula,
                                        price: template.price,
                                        group: template.group,
                                        subItems: template.subItems
                                    });
                                }}
                            />
                        </div>
                        <div className="p-4 border-t flex justify-end">
                            <Button variant="outline" onClick={onCancel}>Cancel</Button>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

export default NewItemModal;
