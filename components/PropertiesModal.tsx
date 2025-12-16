import React, { useState, useEffect, useRef } from 'react';
import { TakeoffItem, ItemProperty, ToolType, Unit, ItemTemplate, SubItem } from '../types';
import { evaluateFormula, convertValue, sanitizeFormula, toVariableName, replaceLabelsWithVars, renameVariable } from '../utils/math';
import { saveTemplate } from '../utils/storage';
import { Plus, Trash2, Calculator, DollarSign, Ruler, LayoutGrid, Save, Check, Layers, Package, Edit2, X, FolderInput, GripVertical } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface PropertiesModalProps {
    item: TakeoffItem;
    items: TakeoffItem[]; // All items to extract existing groups
    onSave: (id: string, updates: Partial<TakeoffItem>) => void;
    onClose: () => void;
}

// Internal Component for Formula Input with Autocomplete
interface FormulaInputProps {
    value: string;
    onChange: (val: string) => void;
    onBlur: () => void;
    placeholder?: string;
    suggestions: { label: string; value: string; desc?: string }[];
    previewValue?: number;
}

const FormulaInput: React.FC<FormulaInputProps> = ({ value, onChange, onBlur, placeholder, suggestions, previewValue }) => {
    const [showSuggestions, setShowSuggestions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Filter suggestions based on current word being typed
    const getCurrentWord = () => {
        if (!inputRef.current) return '';
        const text = value;
        const pos = inputRef.current.selectionStart || 0;
        // Find boundaries of word at cursor
        let start = pos;
        while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
            start--;
        }
        return text.substring(start, pos);
    };

    const currentWord = getCurrentWord();
    const filteredSuggestions = currentWord
        ? suggestions.filter(s => s.value.toLowerCase().includes(currentWord.toLowerCase()))
        : suggestions;

    const insertSuggestion = (suggestionValue: string) => {
        const text = value;
        const pos = inputRef.current?.selectionStart || 0;
        let start = pos;
        while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
            start--;
        }

        const newValue = text.substring(0, start) + suggestionValue + text.substring(pos);
        onChange(newValue);
        setShowSuggestions(false);

        // Restore focus and move cursor
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                const newPos = start + suggestionValue.length;
                inputRef.current.setSelectionRange(newPos, newPos);
            }
        }, 10);
    };

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        };
        // Use capture phase to ensure we catch clicks even if propagation is stopped by modal wrapper
        document.addEventListener('mousedown', handleClickOutside, true);
        return () => document.removeEventListener('mousedown', handleClickOutside, true);
    }, []);

    return (
        <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 relative font-mono" ref={containerRef}>
            <span className="text-muted-foreground mr-2 select-none font-sans italic">ƒ:</span>
            <input
                ref={inputRef}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={(e) => {
                    // Delay blur to allow click on suggestion to register
                    setTimeout(() => {
                        if (document.activeElement !== inputRef.current) {
                            setShowSuggestions(false);
                            onBlur();
                        }
                    }, 200);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setShowSuggestions(false);
                }}
                className="bg-transparent w-full outline-none placeholder:text-muted-foreground"
                placeholder={placeholder || "Qty"}
                autoComplete="off"
            />
            {previewValue !== undefined && (
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs bg-muted px-2 py-1 rounded text-muted-foreground pointer-events-none select-none border">
                    = {previewValue.toFixed(2)}
                </div>
            )}

            {/* Suggestions Dropdown */}
            {
                showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md max-h-48 overflow-y-auto">
                        {filteredSuggestions.map((s) => (
                            <button
                                key={s.value}
                                onMouseDown={(e) => e.preventDefault()} // Prevent focus loss
                                onClick={() => insertSuggestion(s.value)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between items-center group transition-colors"
                            >
                                <span className="font-mono font-bold">{s.value}</span>
                                <span className="text-xs text-muted-foreground group-hover:text-accent-foreground">{s.desc || s.label}</span>
                            </button>
                        ))}
                    </div>
                )
            }
        </div >
    );
};

const PropertiesModal: React.FC<PropertiesModalProps> = ({ item, items, onSave, onClose }) => {
    const [activeTab, setActiveTab] = useState<'general' | 'subitems'>('general');

    const [label, setLabel] = useState(item.label);
    const [group, setGroup] = useState(item.group || 'General');
    const [color, setColor] = useState(item.color);
    const [unit, setUnit] = useState<Unit>(item.unit);
    const [price, setPrice] = useState<string>(item.price ? item.price.toString() : '');
    const [properties, setProperties] = useState<ItemProperty[]>(item.properties || []);
    const [formula, setFormula] = useState(item.formula || 'Qty');

    const [subItems, setSubItems] = useState<SubItem[]>(item.subItems || []);

    const [newPropName, setNewPropName] = useState('');
    const [newPropValue, setNewPropValue] = useState('');
    const [previewValue, setPreviewValue] = useState(0);

    const [isTemplateSaved, setIsTemplateSaved] = useState(false);

    // SubItem Form State
    const [subLabel, setSubLabel] = useState('');
    const [subUnit, setSubUnit] = useState('EA');
    const [subPrice, setSubPrice] = useState('');
    const [subFormula, setSubFormula] = useState('Qty');
    const [editingSubItemId, setEditingSubItemId] = useState<string | null>(null);
    const [editingPropertyIndex, setEditingPropertyIndex] = useState<number | null>(null);
    const [draggedSubItemId, setDraggedSubItemId] = useState<string | null>(null);
    const [isDraggingSub, setIsDraggingSub] = useState(false);

    // Refs for auto-scroll
    const propertyEditRef = useRef<HTMLDivElement>(null);
    const subItemEditRef = useRef<HTMLDivElement>(null);

    const availableUnits: Unit[] = Object.values(Unit);
    const subItemUnits = Array.from(new Set([...Object.values(Unit), 'Sheets', 'Rolls', 'Gallons', 'Lbs', 'Pcs', 'Ton']));

    // Extract unique groups from all items
    const existingGroups = Array.from(new Set(
        items
            .map(i => i.group || 'General')
            .filter(g => g.trim() !== '')
    )).sort();

    const variableSuggestions = [
        { label: 'Base Quantity', value: 'Qty', desc: 'The measured value' },
        { label: 'Unit Price', value: 'Price', desc: 'Price per unit' },
        ...properties.map(p => ({ label: p.name, value: toVariableName(p.name), desc: `Value: ${p.value}` })),
        ...subItems.map(s => ({ label: s.label, value: toVariableName(s.label), desc: 'Sub-Item Qty' }))
    ];

    useEffect(() => {
        const convertedQty = convertValue(item.totalValue, item.unit, unit, item.type);
        const tempItem: TakeoffItem = {
            ...item,
            properties,
            formula,
            unit,
            totalValue: item.totalValue
        };
        setPreviewValue(evaluateFormula(tempItem, convertedQty));
    }, [properties, formula, unit, item]);

    useEffect(() => {
        if (isDraggingSub) {
            const handleGlobalMouseUp = () => {
                setIsDraggingSub(false);
                setDraggedSubItemId(null);
            };
            window.addEventListener('mouseup', handleGlobalMouseUp);
            return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
        }
    }, [isDraggingSub]);

    const handleAddOrUpdateProperty = () => {
        if (newPropName && newPropValue) {
            if (editingPropertyIndex !== null) {
                const oldProp = properties[editingPropertyIndex];
                const newProperties = [...properties];
                newProperties[editingPropertyIndex] = { name: newPropName, value: parseFloat(newPropValue) };
                setProperties(newProperties);
                // If name changed, rename variable in formula and sub-items
                if (oldProp.name !== newPropName) {
                    setFormula(prev => renameVariable(prev, oldProp.name, newPropName));
                    setSubItems(prev => prev.map(s => ({
                        ...s,
                        formula: renameVariable(s.formula, oldProp.name, newPropName)
                    })));
                }
                setEditingPropertyIndex(null);
            } else {
                setProperties([...properties, { name: newPropName, value: parseFloat(newPropValue) }]);
            }
            setNewPropName('');
            setNewPropValue('');
        }
    };

    const removeProperty = (index: number) => {
        const newProps = [...properties];
        newProps.splice(index, 1);
        setProperties(newProps);
    };

    const startEditingProperty = (index: number) => {
        const prop = properties[index];
        setNewPropName(prop.name);
        setNewPropValue(prop.value.toString());
        setEditingPropertyIndex(index);
        // Scroll to edit section
        setTimeout(() => {
            propertyEditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    };

    const cancelEditProperty = () => {
        setEditingPropertyIndex(null);
        setNewPropName('');
        setNewPropValue('');
    };

    const handleTabChange = (tab: 'general' | 'subitems') => {
        // Cancel any active edits when switching tabs
        if (tab === 'subitems') {
            cancelEditProperty();
        } else {
            cancelEditSubItem();
        }
        setActiveTab(tab);
    };

    const handleBlurFormula = () => {
        const withVars = replaceLabelsWithVars(formula, variableSuggestions);
        const fixed = sanitizeFormula(withVars);
        setFormula(fixed);
    };

    const handleAddOrUpdateSubItem = () => {
        if (subLabel && subFormula) {
            const withVars = replaceLabelsWithVars(subFormula, variableSuggestions);
            const sanitized = sanitizeFormula(withVars);

            if (editingSubItemId) {
                const oldSub = subItems.find(s => s.id === editingSubItemId);

                setSubItems(prev => prev.map(s => {
                    if (s.id === editingSubItemId) {
                        return {
                            ...s,
                            label: subLabel,
                            unit: subUnit,
                            price: subPrice ? parseFloat(subPrice) : 0,
                            formula: sanitized
                        };
                    }
                    if (oldSub && oldSub.label !== subLabel) {
                        return {
                            ...s,
                            formula: renameVariable(s.formula, oldSub.label, subLabel)
                        };
                    }
                    return s;
                }));

                if (oldSub && oldSub.label !== subLabel) {
                    setFormula(prev => renameVariable(prev, oldSub.label, subLabel));
                }

                setEditingSubItemId(null);
            } else {
                const newSub: SubItem = {
                    id: crypto.randomUUID(),
                    label: subLabel,
                    unit: subUnit,
                    price: subPrice ? parseFloat(subPrice) : 0,
                    formula: sanitized
                };
                setSubItems([...subItems, newSub]);
            }

            setSubLabel('');
            setSubPrice('');
            setSubFormula('Qty');
            setSubUnit('EA');
        }
    };

    const startEditingSubItem = (sub: SubItem) => {
        setSubLabel(sub.label);
        setSubUnit(sub.unit as string);
        setSubPrice(sub.price.toString());
        setSubFormula(sub.formula);
        setEditingSubItemId(sub.id);
        // Scroll to edit section
        setTimeout(() => {
            subItemEditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    };

    const cancelEditSubItem = () => {
        setEditingSubItemId(null);
        setSubLabel('');
        setSubPrice('');
        setSubFormula('Qty');
        setSubUnit('EA');
    };

    const removeSubItem = (id: string) => {
        if (editingSubItemId === id) cancelEditSubItem();
        setSubItems(subItems.filter(s => s.id !== id));
    };

    const handleSubItemMouseDown = (e: React.MouseEvent, subItemId: string) => {
        // Ignore drag if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('button')) {
            return;
        }

        console.log('[MOUSE-DRAG] SubItem MouseDown:', subItemId);
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingSub(true);
        setDraggedSubItemId(subItemId);
    };

    const handleSubItemMouseUp = (e: React.MouseEvent, targetSubItemId: string) => {
        if (!isDraggingSub || !draggedSubItemId || draggedSubItemId === targetSubItemId) {
            if (isDraggingSub) {
                console.log('[MOUSE-DRAG] SubItem drop cancelled');
            }
            setIsDraggingSub(false);
            setDraggedSubItemId(null);
            return;
        }

        console.log('[MOUSE-DRAG] SubItem MouseUp - reordering');
        const draggedIndex = subItems.findIndex(s => s.id === draggedSubItemId);
        const targetIndex = subItems.findIndex(s => s.id === targetSubItemId);

        if (draggedIndex === -1 || targetIndex === -1) {
            console.log('[MOUSE-DRAG] SubItem drop cancelled - item not found');
            setIsDraggingSub(false);
            setDraggedSubItemId(null);
            return;
        }

        const newSubItems = [...subItems];
        const [draggedItem] = newSubItems.splice(draggedIndex, 1);
        newSubItems.splice(targetIndex, 0, draggedItem);

        setSubItems(newSubItems);
        setIsDraggingSub(false);
        setDraggedSubItemId(null);
        console.log('[MOUSE-DRAG] SubItem reorder completed');
    };

    const handleSave = () => {
        const withVars = replaceLabelsWithVars(formula, variableSuggestions);
        const finalFormula = sanitizeFormula(withVars);

        onSave(item.id, {
            label,
            group: group.trim() || 'General',
            color,
            unit,
            price: price ? parseFloat(price) : undefined,
            properties,
            formula: finalFormula,
            subItems
        });
        onClose();
    };

    const handleSaveAsTemplate = async () => {
        const withVars = replaceLabelsWithVars(formula, variableSuggestions);
        // Use current state values
        const template: ItemTemplate = {
            id: crypto.randomUUID(),
            label,
            type: item.type,
            color,
            unit,
            properties,
            subItems,
            price: price ? parseFloat(price) : undefined,
            formula: sanitizeFormula(withVars),
            group: group.trim() || 'General',
            createdAt: Date.now()
        };
        await saveTemplate(template);
        setIsTemplateSaved(true);
        setTimeout(() => setIsTemplateSaved(false), 2000);
    };

    const getSubItemPreview = () => {
        const convertedQty = convertValue(item.totalValue, item.unit, unit, item.type);
        const tempItem: TakeoffItem = { ...item, properties, unit, totalValue: item.totalValue };

        const subContext: Record<string, number> = {};

        for (const s of subItems) {
            if (s.id === editingSubItemId) break;

            const val = evaluateFormula(tempItem, convertedQty, s.formula, subContext);
            const varName = toVariableName(s.label);
            if (varName) subContext[varName] = val;
        }

        const currentInputWithVars = replaceLabelsWithVars(subFormula, variableSuggestions);
        return evaluateFormula(tempItem, convertedQty, sanitizeFormula(currentInputWithVars), subContext);
    };

    // Simplified View for Ruler (Dimension)
    if (item.type === ToolType.DIMENSION) {
        return (
            <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Ruler Properties</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Color</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="color"
                                        value={color}
                                        onChange={e => setColor(e.target.value)}
                                        className="h-10 w-16 p-1 cursor-pointer"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Unit Display</Label>
                                <Select value={unit} onValueChange={(val) => setUnit(val as Unit)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableUnits.map(u => (
                                            <SelectItem key={u} value={u}>{u}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button onClick={handleSave}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    // Simplified View for Note
    if (item.type === ToolType.NOTE) {
        return (
            <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Note Properties</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="flex items-center gap-1">
                                <FolderInput size={14} /> Group
                            </Label>
                            <Input
                                value={group}
                                onChange={e => setGroup(e.target.value)}
                                list="group-suggestions-note"
                            />
                            <datalist id="group-suggestions-note">
                                <option value="General" />
                                <option value="Notes" />
                                <option value="Annotations" />
                            </datalist>
                        </div>
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="color"
                                    value={color}
                                    onChange={e => setColor(e.target.value)}
                                    className="h-10 w-full p-1 cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button onClick={handleSave}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-fit w-full sm:w-auto min-w-[600px] h-[90vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b">
                    <DialogTitle>Item Properties</DialogTitle>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as 'general' | 'subitems')} className="flex-1 flex flex-col overflow-hidden">
                    <div className="px-6 pt-2 pb-2">
                        <TabsList className="w-full grid grid-cols-2 h-auto p-1 bg-muted rounded-lg">
                            <TabsTrigger value="general">General & Variables</TabsTrigger>
                            <TabsTrigger value="subitems" className="gap-2">
                                <Layers size={14} /> Sub-Items
                                <Badge variant="secondary" className="px-1.5 py-0 h-5 min-w-[1.25rem]">{subItems.length}</Badge>
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <ScrollArea className="flex-1 min-h-0">
                        <TabsContent value="general" className="mt-0 space-y-6 p-6">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-2 space-y-2">
                                    <Label>Name</Label>
                                    <Input value={label} onChange={e => setLabel(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Color</Label>
                                    <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-full p-1 cursor-pointer" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-1"><FolderInput size={14} /> Group</Label>
                                    <Input value={group} onChange={e => setGroup(e.target.value)} list="group-suggestions" />
                                    <datalist id="group-suggestions">
                                        {existingGroups.map(g => (
                                            <option key={g} value={g} />
                                        ))}
                                    </datalist>
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-1">
                                        {item.type === ToolType.AREA ? <LayoutGrid size={14} /> : <Ruler size={14} />} Unit
                                    </Label>
                                    <Select value={unit} onValueChange={(val) => setUnit(val as Unit)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableUnits.map(u => (
                                                <SelectItem key={u} value={u}>{u}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-1"><DollarSign size={14} /> Price</Label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground text-sm">$</span>
                                        <Input
                                            type="number"
                                            placeholder="0.00"
                                            value={price}
                                            onChange={e => setPrice(e.target.value)}
                                            className="pl-7"
                                        />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <Calculator size={13} /> Formula
                                </h3>

                                <FormulaInput
                                    value={formula}
                                    onChange={setFormula}
                                    onBlur={handleBlurFormula}
                                    suggestions={variableSuggestions}
                                    previewValue={previewValue}
                                />

                                <div className="text-xs text-muted-foreground flex flex-wrap gap-1.5 items-center">
                                    <span>Variables:</span>
                                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 h-5">Qty</Badge>
                                    {properties.map(p => (
                                        <Badge key={p.name} variant="outline" className="font-mono text-[10px] px-1.5 h-5 max-w-[150px] truncate" title={toVariableName(p.name)}>{toVariableName(p.name)}</Badge>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Variables</h3>
                                <div className="space-y-2">
                                    {properties.map((prop, idx) => {
                                        const isEditing = editingPropertyIndex === idx;
                                        return (
                                            <div key={idx} className={cn("flex items-center gap-2", isEditing && "bg-muted p-2 rounded-md")}>
                                                <div className="flex-1 px-3 py-2 rounded-md border text-sm font-medium bg-background">{prop.name}</div>
                                                <div className="text-[11px] text-muted-foreground font-mono">as {toVariableName(prop.name)}</div>
                                                <div className="w-24 px-3 py-2 rounded-md border text-sm font-mono text-right bg-background">{prop.value}</div>
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
                                                    onClick={() => startEditingProperty(idx)}
                                                >
                                                    <Edit2 size={14} />
                                                </Button>
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    onClick={() => removeProperty(idx)}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>

                                <Card ref={propertyEditRef} className="bg-muted/50 border-dashed rounded-xl border">
                                    <CardContent className="p-3 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                                {editingPropertyIndex !== null ? 'Edit Variable' : 'Add New Variable'}
                                            </h4>
                                            {editingPropertyIndex !== null && (
                                                <Button variant="ghost" size="sm" onClick={cancelEditProperty} className="h-6 text-xs gap-1">
                                                    <X size={12} /> Cancel Edit
                                                </Button>
                                            )}
                                        </div>
                                        <div className="flex gap-2 items-end">
                                            <div className="flex-1 space-y-1">
                                                <Label className="text-[10px] uppercase text-muted-foreground">Name</Label>
                                                <Input
                                                    placeholder="e.g. Wall Height"
                                                    value={newPropName}
                                                    onChange={e => setNewPropName(e.target.value)}
                                                    className="bg-background"
                                                />
                                            </div>
                                            <div className="w-24 space-y-1">
                                                <Label className="text-[10px] uppercase text-muted-foreground">Value</Label>
                                                <Input
                                                    type="number"
                                                    placeholder="0.00"
                                                    value={newPropValue}
                                                    onChange={e => setNewPropValue(e.target.value)}
                                                    className="bg-background text-right"
                                                />
                                            </div>
                                            <Button
                                                onClick={handleAddOrUpdateProperty}
                                                disabled={!newPropName || !newPropValue}
                                                size="icon"
                                                className="mb-0.5"
                                            >
                                                {editingPropertyIndex !== null ? <Save size={16} /> : <Plus size={16} />}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>

                        <TabsContent value="subitems" className="mt-0 space-y-6 p-6">
                            <div className="bg-blue-50/50 text-blue-800 px-3 py-2 rounded-lg text-xs flex gap-2 border border-blue-100 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-900">
                                <Package size={14} className="shrink-0 mt-0.5" />
                                <p>Sub-items break down this item into materials (e.g. Plywood, Studs) using custom formulas.</p>
                            </div>

                            <div className="space-y-3">
                                {(() => {
                                    const displayContext: Record<string, number> = {};
                                    const convertedQty = convertValue(item.totalValue, item.unit, unit, item.type);
                                    const tempItem2 = { ...item, properties, unit, totalValue: item.totalValue };

                                    return subItems.map((sub) => {
                                        const subPreview = evaluateFormula(tempItem2, convertedQty, sub.formula, displayContext);

                                        const varName = toVariableName(sub.label);
                                        if (varName) displayContext[varName] = subPreview;

                                        const isEditing = editingSubItemId === sub.id;

                                        return (
                                            <div
                                                key={sub.id}
                                                onMouseDown={(e) => handleSubItemMouseDown(e, sub.id)}
                                                onMouseUp={(e) => handleSubItemMouseUp(e, sub.id)}
                                                className={cn(
                                                    "bg-card border rounded-lg p-3 transition-all cursor-grab active:cursor-grabbing select-none hover:border-primary/50",
                                                    isEditing && "border-primary ring-1 ring-primary/20",
                                                    draggedSubItemId === sub.id && isDraggingSub && "opacity-50"
                                                )}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="flex items-center gap-3">
                                                        <div className="cursor-grab text-muted-foreground hover:text-foreground">
                                                            <GripVertical size={16} />
                                                        </div>
                                                        <div className="bg-muted p-2 rounded border text-muted-foreground">
                                                            <Layers size={16} />
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-sm truncate" title={sub.label}>{sub.label}</h4>
                                                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                                <code className="bg-muted px-1.5 border rounded">{sub.formula}</code>
                                                                <span>= {subPreview.toFixed(2)} {sub.unit}</span>
                                                                {sub.price > 0 && <span>@ ${sub.price.toFixed(2)}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <Button
                                                            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
                                                            onClick={() => startEditingSubItem(sub)}
                                                        >
                                                            <Edit2 size={14} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                            onClick={() => removeSubItem(sub.id)}
                                                        >
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                                {subItems.length === 0 && (
                                    <div className="text-center py-6 text-muted-foreground text-sm italic border-2 border-dashed rounded-lg">
                                        No sub-items yet. Add one below.
                                    </div>
                                )}
                            </div>

                            <Card ref={subItemEditRef} className="bg-muted/50 border-dashed">
                                <CardContent className="p-4 space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                            {editingSubItemId ? 'Edit Sub-Item' : 'Add New Sub-Item'}
                                        </h4>
                                        {editingSubItemId && (
                                            <Button variant="ghost" size="sm" onClick={cancelEditSubItem} className="h-6 text-xs gap-1">
                                                <X size={12} /> Cancel Edit
                                            </Button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] uppercase text-muted-foreground">Name</Label>
                                            <Input
                                                value={subLabel}
                                                onChange={e => setSubLabel(e.target.value)}
                                                placeholder="e.g. Drywall Sheets"
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] uppercase text-muted-foreground">Unit</Label>
                                            <Select value={subUnit} onValueChange={setSubUnit}>
                                                <SelectTrigger className="bg-background">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {subItemUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-[10px] uppercase text-muted-foreground">Formula</Label>
                                        <FormulaInput
                                            value={subFormula}
                                            onChange={setSubFormula}
                                            onBlur={() => {
                                                const withVars = replaceLabelsWithVars(subFormula, variableSuggestions);
                                                const fixed = sanitizeFormula(withVars);
                                                setSubFormula(fixed);
                                            }}
                                            suggestions={variableSuggestions}
                                            previewValue={getSubItemPreview()}
                                            placeholder="Qty / 32"
                                        />
                                    </div>

                                    <div className="flex items-end gap-3">
                                        <div className="flex-1 space-y-1">
                                            <Label className="text-[10px] uppercase text-muted-foreground">Unit Price</Label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-muted-foreground text-xs">$</span>
                                                <Input
                                                    type="number"
                                                    value={subPrice}
                                                    onChange={e => setSubPrice(e.target.value)}
                                                    placeholder="0.00"
                                                    className="pl-6 bg-background"
                                                />
                                            </div>
                                        </div>
                                        <Button
                                            onClick={handleAddOrUpdateSubItem}
                                            disabled={!subLabel || !subFormula}
                                            className="w-24"
                                        >
                                            {editingSubItemId ? <Save size={16} className="mr-2" /> : <Plus size={16} className="mr-2" />}
                                            {editingSubItemId ? 'Update' : 'Add'}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </ScrollArea>
                </Tabs>

                <div className="px-6 py-4 border-t flex justify-between items-center bg-muted/20">
                    <Button
                        variant="ghost"
                        onClick={handleSaveAsTemplate}
                        className={cn("text-muted-foreground hover:text-foreground", isTemplateSaved && "text-green-600 hover:text-green-700")}
                        title="Save as Template for future use"
                    >
                        {isTemplateSaved ? <Check size={14} className="mr-2" /> : <Save size={14} className="mr-2" />}
                        {isTemplateSaved ? 'Saved!' : 'Save as Template'}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button onClick={handleSave}>Save</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PropertiesModal;
