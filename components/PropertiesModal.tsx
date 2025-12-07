
import React, { useState, useEffect, useRef } from 'react';
import { TakeoffItem, ItemProperty, ToolType, Unit, ItemTemplate, SubItem } from '../types';
import { evaluateFormula, convertValue, sanitizeFormula, toVariableName, replaceLabelsWithVars, renameVariable } from '../utils/math';
import { saveTemplate } from '../utils/storage';
import { Plus, Trash2, Calculator, DollarSign, Ruler, LayoutGrid, Save, Check, Layers, Package, Edit2, X, FolderInput, GripVertical } from 'lucide-react';

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
        <div className="relative" ref={containerRef}>
            <div className="bg-slate-800 text-green-400 p-2 rounded-lg font-mono text-sm relative flex items-center">
                <span className="text-slate-500 mr-2">ƒ:</span>
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
                    className="bg-transparent w-full outline-none placeholder-slate-600 text-green-400"
                    placeholder={placeholder || "Qty"}
                    autoComplete="off"
                />
                {previewValue !== undefined && (
                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs bg-slate-700 px-2 py-1 rounded text-slate-300 pointer-events-none">
                        = {previewValue.toFixed(2)}
                    </div>
                )}
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {filteredSuggestions.map((s) => (
                        <button
                            key={s.value}
                            onMouseDown={(e) => e.preventDefault()} // Prevent focus loss
                            onClick={() => insertSuggestion(s.value)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center group"
                        >
                            <span className="font-mono font-bold text-slate-700">{s.value}</span>
                            <span className="text-xs text-slate-400 group-hover:text-blue-500">{s.desc || s.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
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
            <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-2xl shadow-2xl w-[350px] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                    <div className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center">
                        <h2 className="text-lg font-semibold text-slate-900">Ruler Properties</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">✕</button>
                    </div>

                    <div className="p-6 space-y-5">
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-2">Name</label>
                            <input
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                                className="w-full border border-slate-200 px-3 py-2 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-2">Color</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={color}
                                    onChange={e => setColor(e.target.value)}
                                    className="h-10 w-full p-1 border border-slate-200 rounded-lg cursor-pointer"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-2">Unit Display</label>
                            <select
                                value={unit}
                                onChange={(e) => setUnit(e.target.value as Unit)}
                                className="w-full border border-slate-200 px-3 py-2 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                            >
                                {availableUnits.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                        <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                        <button onClick={handleSave} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors">Save</button>
                    </div>
                </div>
            </div>
        );
    }

    // Simplified View for Note
    if (item.type === ToolType.NOTE) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-2xl shadow-2xl w-[350px] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                    <div className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center">
                        <h2 className="text-lg font-semibold text-slate-900">Note Properties</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">✕</button>
                    </div>

                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Name</label>
                            <input
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                                className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                                <FolderInput size={12} /> Group
                            </label>
                            <input
                                value={group}
                                onChange={e => setGroup(e.target.value)}
                                list="group-suggestions"
                                className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900"
                            />
                            <datalist id="group-suggestions">
                                <option value="General" />
                                <option value="Notes" />
                                <option value="Annotations" />
                            </datalist>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Color</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={color}
                                    onChange={e => setColor(e.target.value)}
                                    className="h-10 w-full p-1 border border-slate-200 rounded cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                        <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                        <button onClick={handleSave} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors">Save</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-[650px] max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-slate-900">Item Properties</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">✕</button>
                </div>

                <div className="flex border-b border-slate-100 bg-white">
                    <button
                        onClick={() => handleTabChange('general')}
                        className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-all ${activeTab === 'general' ? 'border-slate-900 text-slate-900 bg-slate-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/30'}`}
                    >
                        General & Variables
                    </button>
                    <button
                        onClick={() => handleTabChange('subitems')}
                        className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-all flex items-center justify-center gap-2 ${activeTab === 'subitems' ? 'border-slate-900 text-slate-900 bg-slate-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/30'}`}
                    >
                        <Layers size={14} /> Sub-Items <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full font-semibold">{subItems.length}</span>
                    </button>
                </div>

                <div className="p-5 overflow-y-auto flex-1 space-y-4">

                    {activeTab === 'general' ? (
                        <>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2">
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Name</label>
                                    <input
                                        value={label}
                                        onChange={e => setLabel(e.target.value)}
                                        className="w-full border border-slate-200 px-3 py-2 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Color</label>
                                    <input
                                        type="color"
                                        value={color}
                                        onChange={e => setColor(e.target.value)}
                                        className="h-[38px] w-full p-1 border border-slate-200 rounded-lg cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                                        <FolderInput size={12} /> Group
                                    </label>
                                    <input
                                        value={group}
                                        onChange={e => setGroup(e.target.value)}
                                        list="group-suggestions"
                                        className="w-full border border-slate-200 px-3 py-2 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                                    />
                                    <datalist id="group-suggestions">
                                        {existingGroups.map(g => (
                                            <option key={g} value={g} />
                                        ))}
                                    </datalist>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                                        {item.type === ToolType.AREA ? <LayoutGrid size={12} /> : <Ruler size={12} />}
                                        Unit
                                    </label>
                                    <select
                                        value={unit}
                                        onChange={(e) => setUnit(e.target.value as Unit)}
                                        className="w-full border border-slate-200 px-3 py-2 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                                    >
                                        {availableUnits.map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                                        <DollarSign size={12} /> Price
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                                        <input
                                            type="number"
                                            placeholder="0.00"
                                            value={price}
                                            onChange={e => setPrice(e.target.value)}
                                            className="w-full border border-slate-200 px-3 py-2 pl-7 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Calculator size={13} /> Formula
                                </h3>

                                <FormulaInput
                                    value={formula}
                                    onChange={setFormula}
                                    onBlur={handleBlurFormula}
                                    suggestions={variableSuggestions}
                                    previewValue={previewValue}
                                />

                                <div className="mt-2 text-xs text-slate-500 flex flex-wrap gap-1.5">
                                    <span>Variables:</span>
                                    <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded border text-[11px]">Qty</span>
                                    {properties.map(p => (
                                        <span key={p.name} className="font-mono bg-slate-100 px-1.5 py-0.5 rounded border text-[11px]">{toVariableName(p.name)}</span>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Variables</h3>
                                <div className="space-y-1.5 mb-2">
                                    {properties.map((prop, idx) => {
                                        const isEditing = editingPropertyIndex === idx;
                                        return (
                                            <div key={idx} className={`flex items-center gap-2 ${isEditing ? 'bg-blue-50 border border-blue-200 rounded-lg p-2' : ''}`}>
                                                <div className="flex-1 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700">{prop.name}</div>
                                                <div className="text-[11px] text-slate-400 font-mono">as {toVariableName(prop.name)}</div>
                                                <div className="w-20 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-mono text-right">{prop.value}</div>
                                                <button
                                                    onClick={() => startEditingProperty(idx)}
                                                    className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-1.5 rounded transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button onClick={() => removeProperty(idx)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded transition-colors"><Trash2 size={14} /></button>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div ref={propertyEditRef} className="bg-slate-100 p-4 rounded-lg border border-slate-200">
                                    <div className="flex justify-between items-center mb-4">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                            {editingPropertyIndex !== null ? 'Edit Variable' : 'Add New Variable'}
                                        </h4>
                                        {editingPropertyIndex !== null && (
                                            <button onClick={cancelEditProperty} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
                                                <X size={12} /> Cancel Edit
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <label className="text-[10px] font-semibold text-slate-500 uppercase">Name</label>
                                            <input
                                                placeholder="e.g. Wall Height"
                                                value={newPropName}
                                                onChange={e => setNewPropName(e.target.value)}
                                                className={`w-full text-sm px-2.5 py-1.5 border rounded-lg mt-1 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all ${editingPropertyIndex !== null ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50' : 'border-slate-200'}`}
                                            />
                                        </div>
                                        <div className="w-20">
                                            <label className="text-[10px] font-semibold text-slate-500 uppercase">Value</label>
                                            <input
                                                type="number"
                                                placeholder="0.00"
                                                value={newPropValue}
                                                onChange={e => setNewPropValue(e.target.value)}
                                                className={`w-full text-sm px-2.5 py-1.5 border rounded-lg mt-1 text-right bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all ${editingPropertyIndex !== null ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50' : 'border-slate-200'}`}
                                            />
                                        </div>
                                        <button
                                            onClick={handleAddOrUpdateProperty}
                                            disabled={!newPropName || !newPropValue}
                                            className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white p-1.5 rounded-lg transition-colors flex items-center gap-1"
                                        >
                                            {editingPropertyIndex !== null ? <Save size={16} /> : <Plus size={16} />}
                                            {editingPropertyIndex !== null ? 'Update' : 'Add'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-4">
                            <div className="bg-blue-50/50 text-blue-800 px-3 py-2 rounded-lg text-xs flex gap-2">
                                <Package size={14} className="shrink-0 mt-0.5" />
                                <p>Sub-items break down this item into materials (e.g. Plywood, Studs) using custom formulas.</p>
                            </div>

                            <div className="space-y-3">
                                {(() => {
                                    const displayContext: Record<string, number> = {};
                                    const convertedQty = convertValue(item.totalValue, item.unit, unit, item.type);
                                    const tempItem = { ...item, properties, unit, totalValue: item.totalValue };

                                    return subItems.map((sub) => {
                                        const subPreview = evaluateFormula(tempItem, convertedQty, sub.formula, displayContext);

                                        const varName = toVariableName(sub.label);
                                        if (varName) displayContext[varName] = subPreview;

                                        const isEditing = editingSubItemId === sub.id;

                                        return (
                                            <div
                                                key={sub.id}
                                                onMouseDown={(e) => handleSubItemMouseDown(e, sub.id)}
                                                onMouseUp={(e) => handleSubItemMouseUp(e, sub.id)}
                                                className={`bg-slate-50 border rounded-lg p-3 transition-colors cursor-grab active:cursor-grabbing select-none ${isEditing ? 'border-blue-400 ring-1 ring-blue-100' : 'border-slate-200 hover:border-blue-300'} ${draggedSubItemId === sub.id && isDraggingSub ? 'opacity-50' : ''}`}
                                                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="flex items-center gap-3">
                                                        <div className="cursor-grab text-slate-300 hover:text-slate-500">
                                                            <GripVertical size={16} />
                                                        </div>
                                                        <div className="bg-white p-2 rounded border border-slate-200 text-slate-500">
                                                            <Layers size={16} />
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-slate-800 text-sm">{sub.label}</h4>
                                                            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                                                                <span className="font-mono bg-white px-1.5 border rounded">{sub.formula}</span>
                                                                <span>= {subPreview.toFixed(2)} {sub.unit}</span>
                                                                {sub.price > 0 && <span>@ ${sub.price.toFixed(2)}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => startEditingSubItem(sub)}
                                                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => removeSubItem(sub.id)}
                                                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                                {subItems.length === 0 && (
                                    <div className="text-center py-6 text-slate-400 text-sm italic border-2 border-dashed border-slate-200 rounded-lg">
                                        No sub-items yet. Add one below.
                                    </div>
                                )}
                            </div>

                            <div ref={subItemEditRef} className="bg-slate-100 p-4 rounded-lg border border-slate-200">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                        {editingSubItemId ? 'Edit Sub-Item' : 'Add New Sub-Item'}
                                    </h4>
                                    {editingSubItemId && (
                                        <button onClick={cancelEditSubItem} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
                                            <X size={12} /> Cancel Edit
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Name</label>
                                        <input
                                            value={subLabel}
                                            onChange={e => setSubLabel(e.target.value)}
                                            placeholder="e.g. Drywall Sheets"
                                            className={`w-full text-sm p-2 border rounded bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all ${editingSubItemId ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50' : 'border-slate-200'}`}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Unit</label>
                                        <select
                                            value={subUnit}
                                            onChange={e => setSubUnit(e.target.value)}
                                            className={`w-full text-sm p-2 border rounded bg-white text-slate-900 outline-none transition-all ${editingSubItemId ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50' : 'border-slate-200'}`}
                                        >
                                            {subItemUnits.map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Formula</label>
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
                                    <div className="flex-1">
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Unit Price</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-2 text-slate-400 text-xs">$</span>
                                            <input
                                                type="number"
                                                value={subPrice}
                                                onChange={e => setSubPrice(e.target.value)}
                                                placeholder="0.00"
                                                className={`w-full text-sm p-2 pl-6 border rounded bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all ${editingSubItemId ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50' : 'border-slate-200'}`}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleAddOrUpdateSubItem}
                                        disabled={!subLabel || !subFormula}
                                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium h-[38px] flex items-center gap-2"
                                    >
                                        {editingSubItemId ? <Save size={16} /> : <Plus size={16} />}
                                        {editingSubItemId ? 'Update' : 'Add'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <button
                        onClick={handleSaveAsTemplate}
                        className={`text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all ${isTemplateSaved ? 'text-green-600 bg-green-50' : ''}`}
                        title="Save as Template for future use"
                    >
                        {isTemplateSaved ? <Check size={14} /> : <Save size={14} />}
                        {isTemplateSaved ? 'Saved!' : 'Save as Template'}
                    </button>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">Cancel</button>
                        <button onClick={handleSave} className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-1.5 rounded-lg text-sm font-medium shadow-sm transition-all">Save</button>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default PropertiesModal;
