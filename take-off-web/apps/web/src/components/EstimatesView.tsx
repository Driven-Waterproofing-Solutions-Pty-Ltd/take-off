import React, { useState, useEffect } from 'react';
import { TakeoffItem, ToolType, Unit } from '../types';
import { evaluateFormula, convertValue, toVariableName } from '../utils/math';
import { FileSpreadsheet, ArrowLeft, Trash2, GripVertical, Plus, ChevronDown, ChevronRight, Edit2, CornerDownRight, FileText, Tag, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useToast } from '../contexts/ToastContext';
import PromptModal from './PromptModal';
import TemplateManager from './TemplateManager';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
    const [isDragging, setIsDragging] = useState(false);
    const [dragSource, setDragSource] = useState<'item' | 'group' | null>(null);
    const [editingGroup, setEditingGroup] = useState<string | null>(null);
    const [tempGroupName, setTempGroupName] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, itemId: string } | null>(null);
    const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());

    // Modal State
    const [showNewGroupModal, setShowNewGroupModal] = useState(false);

    useEffect(() => {
        if (isDragging) {
            const handleGlobalMouseUp = () => {
                setIsDragging(false);
                setDraggedItemId(null);
                setDraggedGroup(null);
                setDragSource(null);
            };
            window.addEventListener('mouseup', handleGlobalMouseUp);
            return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
        }
    }, [isDragging]);

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
                let totalCost = calculated * (item.price || 0);
                let unitPrice = item.price || 0;

                // Calculate sub-items first to check if we need to derive unit price
                const subItemRows: any[] = [];
                let subItemsTotal = 0;

                if (item.subItems && item.subItems.length > 0) {
                    const subContext: Record<string, number> = {};

                    item.subItems.forEach(sub => {
                        const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);
                        // Store result for subsequent sub-items to use
                        const varName = toVariableName(sub.label);
                        if (varName) subContext[varName] = subQty;

                        const subTotal = subQty * sub.price;
                        subItemsTotal += subTotal;

                        subItemRows.push({
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

                // If unit price is empty/zero but we have sub-items with costs, derive unit price
                if ((!item.price || item.price === 0) && subItemsTotal > 0 && calculated > 0) {
                    totalCost = subItemsTotal;
                    unitPrice = totalCost / calculated;
                } else {
                    // Otherwise calculate the total from the item unit price as it is currently
                    // This means we DO NOT add sub-items total to the main item total if the main item has a price
                    // The user instruction says: "otherwise calculate the total from the item unit price as it is currently"
                    // Current behavior (before my changes) was: const totalCost = calculated * (item.price || 0);
                    // So we revert to that simple calculation if we are not in the "empty unit price" scenario.
                    totalCost = calculated * (item.price || 0);
                }

                // Main Item Row
                allData.push({
                    Group: item.group || 'General',
                    Label: item.label,
                    Type: item.type,
                    Qty: Number(calculated.toFixed(2)),
                    Unit: item.unit,
                    UnitPrice: unitPrice,
                    TotalCost: totalCost,
                    Pages: Array.from(new Set(item.shapes.map(s => Number(s.pageIndex) + 1))).sort((a: number, b: number) => a - b).join(', '),
                });

                // Add Sub Items Rows
                allData.push(...subItemRows);
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
        e.dataTransfer.setData('text/plain', id);
    };

    const handleGroupDragStart = (e: React.DragEvent, group: string) => {
        e.stopPropagation();
        setDraggedGroup(group);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', group);
    };

    const handleMouseDownItem = (e: React.MouseEvent, itemId: string) => {
        // Ignore drag if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('button')) {
            return;
        }

        console.log('[MOUSE-DRAG] MouseDown on item:', itemId);
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        setDraggedItemId(itemId);
        setDraggedGroup(null);
        setDragSource('item');
    };

    const handleMouseDownGroup = (e: React.MouseEvent, group: string) => {
        // Ignore drag if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('button')) {
            return;
        }

        console.log('[MOUSE-DRAG] MouseDown on group:', group);
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        setDraggedGroup(group);
        setDraggedItemId(null);
        setDragSource('group');
    };

    const handleMouseUp = (e: React.MouseEvent, target?: { type: 'item', id: string } | { type: 'group', name: string }) => {
        if (!isDragging) return;
        e.stopPropagation();

        console.log('[MOUSE-DRAG] MouseUp', { draggedItemId, draggedGroup, target });

        // Handle item drop on item (reorder)
        if (draggedItemId && target?.type === 'item' && draggedItemId !== target.id) {
            const draggedItem = items.find(i => i.id === draggedItemId);
            const targetItem = items.find(i => i.id === target.id);

            if (draggedItem && targetItem) {
                console.log('[MOUSE-DRAG] Reordering item to target position');
                const newItems = items.filter(i => i.id !== draggedItemId);
                const targetIndex = newItems.findIndex(i => i.id === target.id);
                const updatedDraggedItem = { ...draggedItem, group: targetItem.group };
                newItems.splice(targetIndex, 0, updatedDraggedItem);
                onReorderItems(newItems);
            }
        }

        // Handle item drop on group (move to group)
        else if (draggedItemId && target?.type === 'group') {
            const draggedItem = items.find(i => i.id === draggedItemId);
            if (draggedItem && draggedItem.group !== target.name) {
                console.log('[MOUSE-DRAG] Moving item to group:', target.name);
                const newItems = items.filter(i => i.id !== draggedItemId);
                const updatedDraggedItem = { ...draggedItem, group: target.name };
                newItems.push(updatedDraggedItem);
                onReorderItems(newItems);
            }
        }

        // Handle group reordering
        else if (draggedGroup) {
            let targetGroupName: string | undefined;

            if (target?.type === 'group') {
                targetGroupName = target.name;
            } else if (target?.type === 'item') {
                const targetItem = items.find(i => i.id === target.id);
                if (targetItem) targetGroupName = targetItem.group || 'General';
            }

            if (targetGroupName && draggedGroup !== targetGroupName) {
                console.log('[MOUSE-DRAG] Reordering group');
                const newGroups = [...groups];
                const fromIndex = newGroups.indexOf(draggedGroup);
                const toIndex = newGroups.indexOf(targetGroupName);

                if (fromIndex !== -1 && toIndex !== -1) {
                    newGroups.splice(fromIndex, 1);
                    newGroups.splice(toIndex, 0, draggedGroup);
                    setGroups(newGroups);
                }
            }
        }

        // Clear drag state
        setIsDragging(false);
        setDraggedItemId(null);
        setDraggedGroup(null);
        setDragSource(null);
        console.log('[MOUSE-DRAG] Drag operation completed');
    };

    const handleMouseLeave = () => {
        if (isDragging) {
            console.log('[MOUSE-DRAG] Mouse left container, cancelling drag');
            setIsDragging(false);
            setDraggedItemId(null);
            setDraggedGroup(null);
            setDragSource(null);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDropOnItem = (e: React.DragEvent, targetItemId: string) => {
        console.log('[DRAG] DropOnItem - target:', targetItemId, 'draggedItem:', draggedItemId, 'draggedGroup:', draggedGroup);
        e.preventDefault();
        e.stopPropagation();

        if (draggedGroup) {
            console.log('[DRAG] Drop cancelled - cannot drop group on item');
            return;
        }
        if (!draggedItemId || draggedItemId === targetItemId) {
            console.log('[DRAG] Drop cancelled - no dragged item or same item');
            return;
        }

        const draggedItem = items.find(i => i.id === draggedItemId);
        const targetItem = items.find(i => i.id === targetItemId);

        if (!draggedItem || !targetItem) {
            console.log('[DRAG] Drop cancelled - item not found');
            return;
        }

        console.log('[DRAG] Executing drop - moving item to group:', targetItem.group);
        const newItems = items.filter(i => i.id !== draggedItemId);
        const targetIndex = newItems.findIndex(i => i.id === targetItemId);
        const updatedDraggedItem = { ...draggedItem, group: targetItem.group };

        newItems.splice(targetIndex, 0, updatedDraggedItem);

        onReorderItems(newItems);
        setDraggedItemId(null);
        setDraggedGroup(null);
        console.log('[DRAG] Drop completed successfully');
    };

    const handleDropOnGroup = (e: React.DragEvent, targetGroup: string) => {
        console.log('[DRAG] DropOnGroup - target:', targetGroup, 'draggedItem:', draggedItemId, 'draggedGroup:', draggedGroup);
        e.preventDefault();
        e.stopPropagation();

        // Handle Group Reordering
        if (draggedGroup) {
            if (draggedGroup === targetGroup) {
                console.log('[DRAG] Drop cancelled - cannot drop group on itself');
                return;
            }

            console.log('[DRAG] Reordering group:', draggedGroup, 'to position of:', targetGroup);
            const newGroups = [...groups];
            const fromIndex = newGroups.indexOf(draggedGroup);
            const toIndex = newGroups.indexOf(targetGroup);

            newGroups.splice(fromIndex, 1);
            newGroups.splice(toIndex, 0, draggedGroup);

            setGroups(newGroups);
            setDraggedGroup(null);
            setDraggedItemId(null);
            console.log('[DRAG] Group reorder completed');
            return;
        }

        // Handle Item Moving to Group
        if (draggedItemId) {
            const draggedItem = items.find(i => i.id === draggedItemId);
            if (!draggedItem) {
                console.log('[DRAG] Drop cancelled - dragged item not found');
                return;
            }

            // If dropping on the group header, just move it to the group (append)
            // If it's already in the group, do nothing (reordering handled by dropOnItem)
            if (draggedItem.group === targetGroup) {
                console.log('[DRAG] Drop cancelled - item already in target group');
                return;
            }

            console.log('[DRAG] Moving item to group:', targetGroup);
            const newItems = items.filter(i => i.id !== draggedItemId);
            const updatedDraggedItem = { ...draggedItem, group: targetGroup };

            newItems.push(updatedDraggedItem);

            onReorderItems(newItems);
            setDraggedItemId(null);
            setDraggedGroup(null);
            console.log('[DRAG] Item move to group completed');
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
        <div className="flex-1 h-full bg-background overflow-y-auto p-8 font-sans">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onBack}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft size={20} />
                        </Button>
                        <div>
                            <h1 className="text-2xl font-semibold text-foreground">Project Estimates</h1>
                            <p className="text-muted-foreground text-sm mt-0.5">
                                {activeTab === 'estimates' ? 'Drag rows to reorder or move between groups.' : 'Manage your item templates for quick reuse.'}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        {activeTab === 'estimates' && (
                            <Button
                                variant="outline"
                                onClick={() => setShowNewGroupModal(true)}
                                className="gap-2"
                            >
                                <Plus size={16} /> New Group
                            </Button>
                        )}
                        {activeTab === 'estimates' && (
                            <Button
                                onClick={handleExport}
                                className="gap-2"
                            >
                                <FileSpreadsheet size={16} /> Export to Excel
                            </Button>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border bg-card rounded-t-lg">
                    <button
                        onClick={() => setActiveTab('estimates')}
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'estimates'
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                    >
                        <FileText size={16} /> Estimates
                    </button>
                    <button
                        onClick={() => setActiveTab('templates')}
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'templates'
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                    >
                        <Tag size={16} /> Templates
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'estimates' ? (
                    <>
                        {/* Grouped Table */}
                        <Card className="border-border shadow-sm overflow-hidden">
                            <CardContent className="p-0">
                                <Table onDragOver={handleDragOver}>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50 hover:bg-muted/50 border-b border-border">
                                            <TableHead className="w-8"></TableHead>
                                            <TableHead className="w-1/3">Label</TableHead>
                                            <TableHead className="w-32">Type</TableHead>
                                            <TableHead className="text-right">Qty</TableHead>
                                            <TableHead>Unit</TableHead>
                                            <TableHead className="text-right">Unit Price</TableHead>
                                            <TableHead className="text-right">Total Cost</TableHead>
                                            <TableHead className="text-center w-24">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>

                                    {groups.map(group => {
                                        const groupItems = items.filter(i => (i.group || 'General') === group && i.type !== ToolType.NOTE);

                                        // Calculate Total Cost for the Group (Including Sub-items)
                                        const groupTotalCost = groupItems.reduce((sum, item) => {
                                            const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
                                            const qty = evaluateFormula(item, convertedQty);
                                            let itemTotal = qty * (item.price || 0);
                                            let subItemsTotal = 0;

                                            // Add Sub Items cost (Calculation Context)
                                            if (item.subItems) {
                                                const subContext: Record<string, number> = {};
                                                item.subItems.forEach(sub => {
                                                    const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);
                                                    const varName = toVariableName(sub.label);
                                                    if (varName) subContext[varName] = subQty;
                                                    subItemsTotal += (subQty * sub.price);
                                                });
                                            }

                                            if ((!item.price || item.price === 0) && subItemsTotal > 0) {
                                                itemTotal = subItemsTotal;
                                            } else {
                                                itemTotal += subItemsTotal;
                                            }

                                            return sum + itemTotal;
                                        }, 0);

                                        const isCollapsed = collapsedGroups.has(group);

                                        return (
                                            <TableBody
                                                key={group}
                                                className="border-b border-border last:border-0"
                                                onMouseUp={(e) => handleMouseUp(e, { type: 'group', name: group })}
                                            >
                                                {/* Group Header */}
                                                <TableRow
                                                    onMouseDown={(e) => handleMouseDownGroup(e, group)}
                                                    onMouseUp={(e) => handleMouseUp(e, { type: 'group', name: group })}
                                                    className={`hover:bg-muted/30 transition-colors border-b border-border bg-muted/20 ${draggedGroup === group && isDragging ? 'opacity-50' : ''} cursor-grab active:cursor-grabbing select-none`}
                                                    style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                                                >
                                                    <TableCell colSpan={8} className="py-3">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <div className="cursor-grab text-muted-foreground hover:text-foreground mr-1">
                                                                    <GripVertical size={14} />
                                                                </div>
                                                                <button
                                                                    onClick={() => toggleGroup(group)}
                                                                    className="p-1 hover:bg-muted/50 rounded text-muted-foreground transition-colors"
                                                                >
                                                                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                                                </button>
                                                                {editingGroup === group ? (
                                                                    <Input
                                                                        autoFocus
                                                                        value={tempGroupName}
                                                                        onChange={e => setTempGroupName(e.target.value)}
                                                                        onBlur={saveGroupName}
                                                                        onKeyDown={e => e.key === 'Enter' && saveGroupName()}
                                                                        className="h-7 w-auto font-semibold text-sm"
                                                                    />
                                                                ) : (
                                                                    <div className="flex items-center gap-2 group cursor-pointer" onClick={() => startEditingGroup(group)}>
                                                                        <span className="font-bold text-foreground text-base">{group}</span>
                                                                        <span className="text-muted-foreground opacity-0 group-hover:opacity-100"><Edit2 size={12} /></span>
                                                                    </div>
                                                                )}
                                                                <Badge variant="secondary" className="font-normal text-xs">{groupItems.length} items</Badge>
                                                            </div>
                                                            <div className="text-sm font-semibold text-foreground pr-4">
                                                                {groupTotalCost > 0 && `Subtotal: $${groupTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>

                                                {/* Items */}
                                                {!isCollapsed && groupItems.map(item => {
                                                    const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
                                                    const calculatedValue = evaluateFormula(item, convertedQty);
                                                    let itemTotalCost = calculatedValue * (item.price || 0);
                                                    let displayUnitPrice = item.price || 0;
                                                    let subItemsTotal = 0;

                                                    const subContext: Record<string, number> = {};
                                                    if (item.subItems) {
                                                        const tempContext: Record<string, number> = {};
                                                        item.subItems.forEach(sub => {
                                                            const subQty = evaluateFormula(item, convertedQty, sub.formula, tempContext);
                                                            const varName = toVariableName(sub.label);
                                                            if (varName) tempContext[varName] = subQty;
                                                            subItemsTotal += (subQty * sub.price);
                                                        });
                                                    }

                                                    if ((!item.price || item.price === 0) && subItemsTotal > 0) {
                                                        itemTotalCost = subItemsTotal;
                                                        if (calculatedValue > 0) {
                                                            displayUnitPrice = itemTotalCost / calculatedValue;
                                                        }
                                                    } else {
                                                        itemTotalCost = calculatedValue * (item.price || 0);
                                                    }

                                                    return (
                                                        <React.Fragment key={item.id}>
                                                            {/* Main Item Row */}
                                                            <TableRow
                                                                onMouseDown={(e) => handleMouseDownItem(e, item.id)}
                                                                onMouseUp={(e) => handleMouseUp(e, { type: 'item', id: item.id })}
                                                                onDoubleClick={() => onEditItem(item)}
                                                                onContextMenu={(e) => handleContextMenu(e, item.id)}
                                                                className={`group ${draggedItemId === item.id && isDragging ? 'opacity-50 bg-muted' : 'hover:bg-muted/50'} cursor-grab active:cursor-grabbing select-none`}
                                                                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                                                            >
                                                                <TableCell className="text-center cursor-grab text-muted-foreground hover:text-foreground">
                                                                    <GripVertical size={16} className="inline-block" />
                                                                </TableCell>
                                                                <TableCell className="overflow-hidden">
                                                                    <div className="flex items-center gap-3">
                                                                        {item.subItems && item.subItems.length > 0 && (
                                                                            <button
                                                                                onClick={() => toggleItemSubitems(item.id)}
                                                                                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors shrink-0"
                                                                            >
                                                                                {collapsedItems.has(item.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                                            </button>
                                                                        )}
                                                                        <div className="w-3 h-3 rounded-full shadow-sm shrink-0 ring-1 ring-border" style={{ backgroundColor: item.color }}></div>
                                                                        <span className="font-medium text-foreground truncate text-sm" title={item.label}>{item.label}</span>
                                                                    </div>
                                                                    {item.formula && item.formula !== 'Qty' && (
                                                                        <div className="text-[10px] text-muted-foreground mt-1 font-mono truncate">{item.formula}</div>
                                                                    )}
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                                                                        {item.type}
                                                                    </Badge>
                                                                </TableCell>
                                                                <TableCell className="text-right font-mono font-medium text-foreground">
                                                                    {calculatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                </TableCell>
                                                                <TableCell className="text-muted-foreground text-sm">
                                                                    {item.unit}
                                                                </TableCell>
                                                                <TableCell className="text-right text-muted-foreground text-sm font-medium">
                                                                    {displayUnitPrice > 0 ? `$${displayUnitPrice.toFixed(2)}` : '-'}
                                                                </TableCell>
                                                                <TableCell className="text-right font-semibold text-foreground">
                                                                    {itemTotalCost > 0 ? `$${itemTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                                </TableCell>
                                                                <TableCell className="text-center">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => onDeleteItem(item.id)}
                                                                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                                        title="Delete Item"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>

                                                            {/* Sub Items Rows */}
                                                            {!collapsedItems.has(item.id) && item.subItems && item.subItems.map(sub => {
                                                                const subQty = evaluateFormula(item, convertedQty, sub.formula, subContext);
                                                                const varName = toVariableName(sub.label);
                                                                if (varName) subContext[varName] = subQty;
                                                                const subTotal = subQty * sub.price;

                                                                return (
                                                                    <TableRow key={sub.id} className="bg-muted/10 hover:bg-muted/20 border-0">
                                                                        <TableCell className="border-r border-transparent"></TableCell>
                                                                        <TableCell className="pl-12 overflow-hidden">
                                                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                                                <CornerDownRight size={14} className="text-muted-foreground/50 shrink-0" />
                                                                                <span className="truncate" title={sub.label}>{sub.label}</span>
                                                                                <span className="text-[10px] text-muted-foreground/70 font-mono bg-muted px-1 rounded truncate max-w-[120px]">{sub.formula}</span>
                                                                            </div>
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                                                                                Sub-Item
                                                                            </span>
                                                                        </TableCell>
                                                                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                                                                            {subQty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                        </TableCell>
                                                                        <TableCell className="text-sm text-muted-foreground">
                                                                            {sub.unit}
                                                                        </TableCell>
                                                                        <TableCell className="text-right text-sm text-muted-foreground">
                                                                            ${sub.price.toFixed(2)}
                                                                        </TableCell>
                                                                        <TableCell className="text-right text-sm font-semibold text-muted-foreground">
                                                                            ${subTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                        </TableCell>
                                                                        <TableCell></TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </React.Fragment>
                                                    );
                                                })}
                                                {!isCollapsed && groupItems.length === 0 && (
                                                    <TableRow>
                                                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground text-sm italic">
                                                            Drag items here to add them to this group.
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        );
                                    })}
                                </Table>
                            </CardContent>
                        </Card>

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
                                className="fixed bg-popover text-popover-foreground rounded-md shadow-md border border-border py-1 z-50 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
                                style={{ top: contextMenu.y, left: contextMenu.x }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    onClick={() => {
                                        const item = items.find(i => i.id === contextMenu.itemId);
                                        if (item) onEditItem(item);
                                        setContextMenu(null);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                                >
                                    <Edit2 size={14} /> Properties
                                </button>
                                <div className="h-px bg-border my-1" />
                                <button
                                    onClick={() => {
                                        onDeleteItem(contextMenu.itemId);
                                        setContextMenu(null);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
                                >
                                    <Trash2 size={14} /> Delete
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="h-[calc(100vh-200px)]">
                        <TemplateManager mode="manage" />
                    </div>
                )}

            </div>
        </div>
    );
};

export default EstimatesView;