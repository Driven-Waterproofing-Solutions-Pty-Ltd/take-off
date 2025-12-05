import React, { useState, useEffect } from 'react';
import { TakeoffItem, ToolType, Unit } from '../types';
import { evaluateFormula, convertValue, toVariableName } from '../utils/math';
import { FileSpreadsheet, ArrowLeft, Trash2, GripVertical, Plus, ChevronDown, ChevronRight, Edit2, CornerDownRight, FileText, Tag } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useToast } from '../contexts/ToastContext';
import PromptModal from './PromptModal';
import TemplateManager from './TemplateManager';

interface EstimatesViewProps {
    items: TakeoffItem[];
    onBack: () => void;
    onDeleteItem: (id: string) => void;
    onUpdateItem: (id: string, updates: Partial<TakeoffItem>) => void;
    onReorderItems: (items: TakeoffItem[]) => void;
    onEditItem: (item: TakeoffItem) => void;
}

const EstimatesView: React.FC<EstimatesViewProps> = ({ items, onBack, onDeleteItem, onUpdateItem, onReorderItems, onEditItem }) => {
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState<'estimates' | 'templates'>('estimates');
    const [groups, setGroups] = useState<string[]>([]);
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
    const [editingGroup, setEditingGroup] = useState<string | null>(null);
    const [tempGroupName, setTempGroupName] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, itemId: string } | null>(null);
    const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());

    // Modal State
    const [showNewGroupModal, setShowNewGroupModal] = useState(false);

    // Sync groups with items, ensuring all item groups exist in the list
    useEffect(() => {
        setGroups(prevGroups => {
            const itemGroups = new Set(items.map(i => i.group || 'General'));
            if (itemGroups.size === 0) itemGroups.add('General');

            // Merge current groups (which may contain empty user-created groups) with groups derived from items
            const mergedGroups = new Set([...prevGroups, ...itemGroups]);

            // If we have a manual order (prevGroups), try to respect it for existing groups
            // New groups go to the end
            const newGroups = Array.from(mergedGroups);

            // If the sets are the same size and content, don't update (avoids loops)
            if (newGroups.length === prevGroups.length && newGroups.every(g => prevGroups.includes(g))) {
                return prevGroups;
            }

            // Otherwise, sort initially but allow reordering later
            // We only sort if it's a fresh load or significant change
            if (prevGroups.length === 0) {
                return newGroups.sort((a, b) => {
                    if (a === 'General') return -1;
                    if (b === 'General') return 1;
                    return a.localeCompare(b);
                });
            }

            return newGroups;
        });
    }, [items]);

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    const handleExport = () => {
        try {
            const allData: any[] = [];

            items.filter(i => i.type !== ToolType.NOTE).forEach(item => {
                const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
                const calculated = evaluateFormula(item, convertedQty);
                const totalCost = calculated * (item.price || 0);

                // Main Item Row
                allData.push({
                    Group: item.group || 'General',
                    Label: item.label,
                    Type: item.type,
                    Qty: Number(calculated.toFixed(2)),
                    Unit: item.unit,
                    UnitPrice: item.price || 0,
                    TotalCost: totalCost,
                    Pages: Array.from(new Set(item.shapes.map(s => Number(s.pageIndex) + 1))).sort((a: number, b: number) => a - b).join(', '),
                });

                // Sub Items Rows (Contextual)
                if (item.subItems && item.subItems.length > 0) {
                    const subContext: Record<string, number> = {};

                    item.subItems.forEach(sub => {
                        const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);
                        // Store result for subsequent sub-items to use
                        const varName = toVariableName(sub.label);
                        if (varName) subContext[varName] = subQty;

                        const subTotal = subQty * sub.price;
                        allData.push({
                            Group: item.group || 'General',
                            Label: `  ↳ ${sub.label}`,
                            Type: 'Sub-Item',
                            Qty: Number(subQty.toFixed(2)),
                            Unit: sub.unit,
                            UnitPrice: sub.price,
                            TotalCost: subTotal,
                            Pages: '',
                        });
                    });
                }
            });

            const ws = XLSX.utils.json_to_sheet(allData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Estimates");
            XLSX.writeFile(wb, "Project_Estimates.xlsx");
            addToast("Excel export successful", 'success');
        } catch (e) {
            console.error(e);
            addToast("Export failed", 'error');
        }
    };

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.stopPropagation();
        setDraggedItemId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleGroupDragStart = (e: React.DragEvent, group: string) => {
        setDraggedGroup(group);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDropOnItem = (e: React.DragEvent, targetItemId: string) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedGroup) return; // Don't drop groups on items
        if (!draggedItemId || draggedItemId === targetItemId) return;

        const draggedItem = items.find(i => i.id === draggedItemId);
        const targetItem = items.find(i => i.id === targetItemId);

        if (!draggedItem || !targetItem) return;

        const newItems = items.filter(i => i.id !== draggedItemId);
        const targetIndex = newItems.findIndex(i => i.id === targetItemId);
        const updatedDraggedItem = { ...draggedItem, group: targetItem.group };

        newItems.splice(targetIndex, 0, updatedDraggedItem);

        onReorderItems(newItems);
        setDraggedItemId(null);
    };

    const handleDropOnGroup = (e: React.DragEvent, targetGroup: string) => {
        e.preventDefault();
        e.stopPropagation();

        // Handle Group Reordering
        if (draggedGroup) {
            if (draggedGroup === targetGroup) return;

            const newGroups = [...groups];
            const fromIndex = newGroups.indexOf(draggedGroup);
            const toIndex = newGroups.indexOf(targetGroup);

            newGroups.splice(fromIndex, 1);
            newGroups.splice(toIndex, 0, draggedGroup);

            setGroups(newGroups);
            setDraggedGroup(null);
            return;
        }

        // Handle Item Moving to Group
        if (draggedItemId) {
            const draggedItem = items.find(i => i.id === draggedItemId);
            if (!draggedItem) return;

            // If dropping on the group header, just move it to the group (append)
            // If it's already in the group, do nothing (reordering handled by dropOnItem)
            if (draggedItem.group === targetGroup) return;

            const newItems = items.filter(i => i.id !== draggedItemId);
            const updatedDraggedItem = { ...draggedItem, group: targetGroup };

            newItems.push(updatedDraggedItem);

            onReorderItems(newItems);
            setDraggedItemId(null);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, itemId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, itemId });
    };

    const handleConfirmNewGroup = (name: string) => {
        const trimmed = name.trim();
        if (trimmed) {
            if (groups.includes(trimmed)) {
                addToast("Group already exists", 'error');
            } else {
                setGroups(prev => {
                    const newGroups = [...prev, trimmed];
                    newGroups.sort((a, b) => {
                        if (a === 'General') return -1;
                        if (b === 'General') return 1;
                        return a.localeCompare(b);
                    });
                    return newGroups;
                });
                addToast(`Group "${trimmed}" created`, 'success');
            }
        }
        setShowNewGroupModal(false);
    };

    const startEditingGroup = (group: string) => {
        setEditingGroup(group);
        setTempGroupName(group);
    };

    const saveGroupName = () => {
        if (editingGroup && tempGroupName && tempGroupName !== editingGroup) {
            setGroups(prev => prev.map(g => g === editingGroup ? tempGroupName : g));

            // Update items
            items.forEach(item => {
                if (item.group === editingGroup) {
                    onUpdateItem(item.id, { group: tempGroupName });
                }
            });
        }
        setEditingGroup(null);
    };

    const toggleGroup = (group: string) => {
        setCollapsedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(group)) {
                newSet.delete(group);
            } else {
                newSet.add(group);
            }
            return newSet;
        });
    };

    const toggleItemSubitems = (itemId: string) => {
        setCollapsedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };

    return (
        <div className="flex-1 h-full bg-slate-50 overflow-y-auto p-8 font-sans">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all text-slate-500 hover:text-slate-900 hover:shadow-sm"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-2xl font-semibold text-slate-900">Project Estimates</h1>
                            <p className="text-slate-500 text-sm mt-0.5">
                                {activeTab === 'estimates' ? 'Drag rows to reorder or move between groups.' : 'Manage your item templates for quick reuse.'}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        {activeTab === 'estimates' && (
                            <button
                                onClick={() => setShowNewGroupModal(true)}
                                className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-medium shadow-sm transition-all"
                            >
                                <Plus size={18} /> New Group
                            </button>
                        )}
                        {activeTab === 'estimates' && (
                            <button
                                onClick={handleExport}
                                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-all"
                            >
                                <FileSpreadsheet size={18} /> Export to Excel
                            </button>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 bg-white rounded-t-lg">
                    <button
                        onClick={() => setActiveTab('estimates')}
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'estimates'
                            ? 'border-blue-500 text-blue-600 bg-blue-50'
                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <FileText size={16} /> Estimates
                    </button>
                    <button
                        onClick={() => setActiveTab('templates')}
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'templates'
                            ? 'border-blue-500 text-blue-600 bg-blue-50'
                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                    >
                        <Tag size={16} /> Templates
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'estimates' ? (
                    <>
                        {/* Grouped Table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <table className="w-full text-left border-collapse table-fixed">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        <th className="w-8"></th>
                                        <th className="px-6 py-3 w-1/3">Label</th>
                                        <th className="px-6 py-3 w-32">Type</th>
                                        <th className="px-6 py-3 text-right">Qty</th>
                                        <th className="px-6 py-3">Unit</th>
                                        <th className="px-6 py-3 text-right">Unit Price</th>
                                        <th className="px-6 py-3 text-right">Total Cost</th>
                                        <th className="px-6 py-3 text-center w-24">Actions</th>
                                    </tr>
                                </thead>

                                {groups.map(group => {
                                    const groupItems = items.filter(i => (i.group || 'General') === group && i.type !== ToolType.NOTE);

                                    // Calculate Total Cost for the Group (Including Sub-items)
                                    const groupTotalCost = groupItems.reduce((sum, item) => {
                                        const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
                                        const qty = evaluateFormula(item, convertedQty);
                                        let itemTotal = qty * (item.price || 0);

                                        // Add Sub Items cost (Calculation Context)
                                        if (item.subItems) {
                                            const subContext: Record<string, number> = {};
                                            item.subItems.forEach(sub => {
                                                const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);
                                                // Add to context so subsequent items can reference it
                                                const varName = toVariableName(sub.label);
                                                if (varName) subContext[varName] = subQty;

                                                itemTotal += (subQty * sub.price);
                                            });
                                        }
                                        return sum + itemTotal;
                                    }, 0);

                                    const isCollapsed = collapsedGroups.has(group);

                                    return (
                                        <tbody
                                            key={group}
                                            className="border-b border-slate-100 last:border-0"
                                            onDragOver={handleDragOver}
                                            onDrop={(e) => handleDropOnGroup(e, group)}
                                        >
                                            {/* Group Header */}
                                            <tr
                                                draggable
                                                onDragStart={(e) => handleGroupDragStart(e, group)}
                                                onDragOver={handleDragOver}
                                                onDrop={(e) => handleDropOnGroup(e, group)}
                                                className={`bg-blue-50/50 hover:bg-blue-50 transition-colors border-b border-blue-100 ${draggedGroup === group ? 'opacity-50' : ''}`}
                                            >
                                                <td colSpan={8} className="px-4 py-3">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <div className="cursor-grab text-slate-300 hover:text-slate-500 mr-1">
                                                                <GripVertical size={14} />
                                                            </div>
                                                            <button
                                                                onClick={() => toggleGroup(group)}
                                                                className="p-1 hover:bg-slate-200 rounded text-slate-400 transition-colors"
                                                            >
                                                                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                                            </button>
                                                            {editingGroup === group ? (
                                                                <input
                                                                    autoFocus
                                                                    value={tempGroupName}
                                                                    onChange={e => setTempGroupName(e.target.value)}
                                                                    onBlur={saveGroupName}
                                                                    onKeyDown={e => e.key === 'Enter' && saveGroupName()}
                                                                    className="font-semibold text-slate-900 text-sm bg-white border border-slate-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500"
                                                                />
                                                            ) : (
                                                                <div className="flex items-center gap-2 group cursor-pointer" onClick={() => startEditingGroup(group)}>
                                                                    <span className="font-bold text-slate-900 text-base">{group}</span>
                                                                    <span className="text-slate-400 opacity-0 group-hover:opacity-100"><Edit2 size={12} /></span>
                                                                </div>
                                                            )}
                                                            <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">{groupItems.length} items</span>
                                                        </div>
                                                        <div className="text-sm font-semibold text-slate-700 pr-20">
                                                            {groupTotalCost > 0 && `Subtotal: $${groupTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Items */}
                                            {!isCollapsed && groupItems.map(item => {
                                                const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
                                                const calculatedValue = evaluateFormula(item, convertedQty);
                                                const itemTotalCost = calculatedValue * (item.price || 0);

                                                // Context for sub-item calculations
                                                const subContext: Record<string, number> = {};

                                                return (
                                                    <React.Fragment key={item.id}>
                                                        {/* Main Item Row */}
                                                        <tr
                                                            draggable
                                                            onDragStart={(e) => handleDragStart(e, item.id)}
                                                            onDragOver={handleDragOver}
                                                            onDrop={(e) => handleDropOnItem(e, item.id)}
                                                            onDoubleClick={() => onEditItem(item)}
                                                            onContextMenu={(e) => handleContextMenu(e, item.id)}
                                                            className={`hover:bg-blue-50/50 transition-colors group ${draggedItemId === item.id ? 'opacity-50 bg-slate-100' : 'bg-white'}`}
                                                        >
                                                            <td className="px-2 text-center cursor-grab text-slate-300 hover:text-slate-500">
                                                                <GripVertical size={16} className="inline-block" />
                                                            </td>
                                                            <td className="px-6 py-3 overflow-hidden">
                                                                <div className="flex items-center gap-3">
                                                                    {item.subItems && item.subItems.length > 0 && (
                                                                        <button
                                                                            onClick={() => toggleItemSubitems(item.id)}
                                                                            className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors shrink-0"
                                                                            title={collapsedItems.has(item.id) ? "Show Sub-items" : "Hide Sub-items"}
                                                                        >
                                                                            {collapsedItems.has(item.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                                        </button>
                                                                    )}
                                                                    <div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: item.color }}></div>
                                                                    <span className="font-medium text-slate-800 truncate text-sm" title={item.label}>{item.label}</span>
                                                                </div>
                                                                {item.formula && item.formula !== 'Qty' && (
                                                                    <div className="text-[10px] text-slate-400 mt-1 font-mono truncate" title={item.formula}>{item.formula}</div>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600">
                                                                    {item.type}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3 text-right font-mono font-semibold text-slate-700">
                                                                {calculatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </td>
                                                            <td className="px-6 py-3 text-slate-500 text-sm">
                                                                {item.unit}
                                                            </td>
                                                            <td className="px-6 py-3 text-right text-slate-600 text-sm font-medium">
                                                                {item.price ? `$${item.price.toFixed(2)}` : '-'}
                                                            </td>
                                                            <td className="px-6 py-3 text-right font-semibold text-slate-700">
                                                                {itemTotalCost > 0 ? `$${itemTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                            </td>
                                                            <td className="px-6 py-3 text-center">
                                                                <button
                                                                    onClick={() => onDeleteItem(item.id)}
                                                                    className="text-slate-400 hover:text-red-600 p-2 rounded hover:bg-red-50 transition-colors"
                                                                    title="Delete Item"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </td>
                                                        </tr>

                                                        {/* Sub Items Rows */}
                                                        {!collapsedItems.has(item.id) && item.subItems && item.subItems.map(sub => {
                                                            // Evaluate sub-item formula with context (allows referencing previous sub-items)
                                                            const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);

                                                            // Add this result to context for next items
                                                            const varName = toVariableName(sub.label);
                                                            if (varName) subContext[varName] = subQty;

                                                            const subTotal = subQty * sub.price;

                                                            return (
                                                                <tr key={sub.id} className="bg-slate-50/30 hover:bg-slate-50">
                                                                    <td className="w-8 border-r border-transparent"></td>
                                                                    <td className="px-6 py-2 pl-12 overflow-hidden">
                                                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                                                            <CornerDownRight size={14} className="text-slate-300 shrink-0" />
                                                                            <span className="truncate" title={sub.label}>{sub.label}</span>
                                                                            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1 rounded truncate max-w-[120px]" title={sub.formula}>{sub.formula}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-2">
                                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-400 border border-slate-100">
                                                                            Sub-Item
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-6 py-2 text-right font-mono text-sm text-slate-600">
                                                                        {subQty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </td>
                                                                    <td className="px-6 py-2 text-sm text-slate-500">
                                                                        {sub.unit}
                                                                    </td>
                                                                    <td className="px-6 py-2 text-right text-sm text-slate-500">
                                                                        ${sub.price.toFixed(2)}
                                                                    </td>
                                                                    <td className="px-6 py-2 text-right text-sm font-semibold text-slate-600">
                                                                        ${subTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </td>
                                                                    <td className="px-6 py-2"></td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </React.Fragment>
                                                );
                                            })}
                                            {!isCollapsed && groupItems.length === 0 && (
                                                <tr>
                                                    <td colSpan={8} className="px-6 py-8 text-center text-slate-400 text-sm italic">
                                                        Drag items here to add them to this group.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    );
                                })}

                                {groups.length === 0 && (
                                    <tbody>
                                        <tr>
                                            <td colSpan={8} className="px-6 py-12 text-center text-slate-400 italic">
                                                No measurements recorded yet. Go back to the blueprint to start measuring.
                                            </td>
                                        </tr>
                                    </tbody>
                                )}
                            </table>
                        </div>

                        <PromptModal
                            isOpen={showNewGroupModal}
                            title="Create New Group"
                            message="Enter a name for the new estimating group."
                            placeholder="e.g. Site Work"
                            onConfirm={handleConfirmNewGroup}
                            onCancel={() => setShowNewGroupModal(false)}
                            confirmText="Create Group"
                        />

                        {/* Context Menu */}
                        {contextMenu && (
                            <div
                                className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
                                style={{ top: contextMenu.y, left: contextMenu.x }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    onClick={() => {
                                        const item = items.find(i => i.id === contextMenu.itemId);
                                        if (item) onEditItem(item);
                                        setContextMenu(null);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                    <Edit2 size={14} /> Properties
                                </button>
                                <div className="h-px bg-slate-100 my-1" />
                                <button
                                    onClick={() => {
                                        onDeleteItem(contextMenu.itemId);
                                        setContextMenu(null);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                >
                                    <Trash2 size={14} /> Delete
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="bg-white rounded-b-2xl shadow-sm border border-t-0 border-slate-200 overflow-hidden">
                        <TemplateManager mode="manage" />
                    </div>
                )}

            </div>
        </div>
    );
};

export default EstimatesView;