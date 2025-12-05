import React, { useState, useEffect, useRef } from 'react';
import { ItemTemplate, ToolType, Unit, TakeoffItem } from '../types';
import { getTemplates, deleteTemplate, exportTemplatesToJSON, importTemplatesFromJSON, saveTemplate } from '../utils/storage';
import { Trash2, Download, Upload, Plus, Search, Tag, Edit2, Folder, FolderOpen, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from './ConfirmModal';
import PromptModal from './PromptModal';
import NewTemplateModal from './NewTemplateModal';
import PropertiesModal from './PropertiesModal';

interface TemplateManagerProps {
    mode?: 'manage' | 'select';
    filterToolType?: ToolType;
    onSelect?: (template: ItemTemplate) => void;
    onClose?: () => void;
}

const TemplateManager: React.FC<TemplateManagerProps> = ({ mode = 'manage', filterToolType, onSelect }) => {
    const { addToast } = useToast();
    const [templates, setTemplates] = useState<ItemTemplate[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Group Management
    const [groups, setGroups] = useState<string[]>([]);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [editingGroup, setEditingGroup] = useState<string | null>(null);
    const [tempGroupName, setTempGroupName] = useState('');

    // Modal States
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
    const [showNewGroupModal, setShowNewGroupModal] = useState(false);

    // Template Creation/Editing State
    const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
    const [editingTemplateItem, setEditingTemplateItem] = useState<TakeoffItem | null>(null);
    const [isCreatingNew, setIsCreatingNew] = useState(false);

    const load = async () => {
        const data = await getTemplates();
        setTemplates(data.sort((a, b) => b.createdAt - a.createdAt));

        // Extract unique groups from templates
        const templateGroups = new Set(data.map(t => t.group || 'General').filter(Boolean));
        if (templateGroups.size === 0) templateGroups.add('General');
        setGroups(Array.from(templateGroups).sort());
    };

    useEffect(() => {
        load();
    }, []);

    const handleDeleteRequest = (id: string) => {
        setTemplateToDelete(id);
        setShowDeleteConfirm(true);
    };

    const handleDeleteConfirmed = async () => {
        if (templateToDelete) {
            await deleteTemplate(templateToDelete);
            load();
            addToast("Template deleted", 'info');
        }
        setShowDeleteConfirm(false);
        setTemplateToDelete(null);
    };

    const handleExport = async () => {
        const toExport = selectedIds.size > 0
            ? templates.filter(t => selectedIds.has(t.id))
            : templates;

        if (toExport.length === 0) return;

        try {
            const blob = await exportTemplatesToJSON(toExport);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ProTakeoff_Templates_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            addToast("Templates exported", 'success');
        } catch (e) {
            addToast("Export failed", 'error');
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                await importTemplatesFromJSON(e.target.files[0]);
                load();
                addToast("Templates imported successfully", 'success');
            } catch (err) {
                console.error(err);
                addToast("Failed to import templates. Invalid file format.", 'error');
            }
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    // Filter Logic
    const filtered = templates.filter(t => {
        if (filterToolType && t.type !== filterToolType) return false;
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            return t.label.toLowerCase().includes(lower) || t.group?.toLowerCase().includes(lower);
        }
        return true;
    });

    // Group Management Functions
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

    const handleConfirmNewGroup = (name: string) => {
        const trimmed = name.trim();
        if (trimmed && !groups.includes(trimmed)) {
            setGroups(prev => [...prev, trimmed].sort());
            addToast(`Group "${trimmed}" created`, 'success');
        }
        setShowNewGroupModal(false);
    };

    const startEditingGroup = (group: string) => {
        setEditingGroup(group);
        setTempGroupName(group);
    };

    const saveGroupName = () => {
        if (editingGroup && tempGroupName && tempGroupName !== editingGroup) {
            // Update group name in groups array
            setGroups(prev => prev.map(g => g === editingGroup ? tempGroupName : g).sort());

            // Update all templates in the group
            templates.forEach(async template => {
                if (template.group === editingGroup) {
                    await saveTemplate({ ...template, group: tempGroupName });
                }
            });

            addToast('Group renamed successfully', 'success');
            load(); // Reload to reflect changes
        }
        setEditingGroup(null);
    };

    const handleEditTemplate = (template: ItemTemplate) => {
        // Convert template to a temporary TakeoffItem for the PropertiesModal
        const tempItem: TakeoffItem = {
            id: template.id,
            label: template.label,
            type: template.type,
            color: template.color,
            unit: template.unit,
            totalValue: 100, // Dummy value for preview
            price: template.price || 0,
            formula: template.formula,
            properties: template.properties || [],
            subItems: template.subItems || [],
            group: template.group,
            shapes: [],
            visible: true
        };
        setEditingTemplateItem(tempItem);
        setIsCreatingNew(false);
    };

    const handleCreateTemplate = () => {
        setShowNewTemplateModal(true);
    };

    const handleNextStepCreate = (name: string, type: ToolType, color: string) => {
        setShowNewTemplateModal(false);

        // Create a temporary item for the PropertiesModal
        const tempItem: TakeoffItem = {
            id: crypto.randomUUID(),
            label: name,
            type: type,
            color: color,
            unit: Unit.EACH, // Default, user can change in modal
            totalValue: 100,
            price: 0,
            formula: 'Qty',
            properties: [],
            subItems: [],
            group: 'General',
            shapes: [],
            visible: true
        };
        setEditingTemplateItem(tempItem);
        setIsCreatingNew(true);
    };

    const handleSaveProperties = async (id: string, updates: Partial<TakeoffItem>) => {
        if (!editingTemplateItem) return;

        const templateData: ItemTemplate = {
            id: isCreatingNew ? editingTemplateItem.id : editingTemplateItem.id,
            label: updates.label || editingTemplateItem.label,
            type: editingTemplateItem.type, // Type cannot be changed
            color: updates.color || editingTemplateItem.color,
            unit: updates.unit || editingTemplateItem.unit,
            price: updates.price,
            formula: updates.formula || editingTemplateItem.formula,
            properties: updates.properties || editingTemplateItem.properties,
            subItems: updates.subItems || editingTemplateItem.subItems,
            group: updates.group || editingTemplateItem.group || 'General',
            createdAt: isCreatingNew ? Date.now() : (templates.find(t => t.id === id)?.createdAt || Date.now())
        };

        await saveTemplate(templateData);
        addToast(isCreatingNew ? "Template created" : "Template updated", 'success');
        setEditingTemplateItem(null);
        load();
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b bg-white flex justify-between items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input
                        className="w-full pl-9 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-900"
                        placeholder="Search templates..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex gap-1">
                    <button onClick={() => setShowNewGroupModal(true)} className="p-2 text-slate-500 hover:bg-slate-100 rounded" title="New Group">
                        <Folder size={18} />
                    </button>
                    <button onClick={handleCreateTemplate} className="p-2 text-slate-500 hover:bg-slate-100 rounded" title="New Template">
                        <Plus size={18} />
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-500 hover:bg-slate-100 rounded" title="Import Templates">
                        <Upload size={18} />
                    </button>
                    <button onClick={handleExport} className="p-2 text-slate-500 hover:bg-slate-100 rounded" title="Export Templates">
                        <Download size={18} />
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                </div>
            </div>

            {/* Grouped Content */}
            <div className="flex-1 overflow-y-auto">
                {groups.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 italic">
                        No templates or groups created yet.
                    </div>
                ) : (
                    groups.map(group => {
                        const groupTemplates = filtered.filter(t => (t.group || 'General') === group);
                        const isCollapsed = collapsedGroups.has(group);

                        return (
                            <div key={group} className="border-b border-slate-100 last:border-0">
                                {/* Group Header */}
                                <div className="bg-slate-50 px-4 py-3 flex items-center justify-between hover:bg-slate-100 transition-colors">
                                    <div className="flex items-center gap-2">
                                        <div className="cursor-grab text-slate-300 hover:text-slate-500">
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
                                                className="font-semibold text-slate-900 text-sm bg-white border border-slate-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        ) : (
                                            <div className="flex items-center gap-2 group cursor-pointer" onClick={() => startEditingGroup(group)}>
                                                <FolderOpen size={14} className="text-slate-400" />
                                                <span className="font-semibold text-slate-900 text-sm">{group}</span>
                                                <span className="text-slate-400 opacity-0 group-hover:opacity-100"><Edit2 size={12} /></span>
                                            </div>
                                        )}
                                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                                            {groupTemplates.length} templates
                                        </span>
                                    </div>
                                </div>

                                {/* Group Templates */}
                                {!isCollapsed && (
                                    <div className="p-3 space-y-2 bg-white">
                                        {groupTemplates.length === 0 ? (
                                            <div className="text-center text-slate-400 text-sm italic py-4">
                                                No templates in this group.
                                            </div>
                                        ) : (
                                            groupTemplates.map(t => (
                                                <div
                                                    key={t.id}
                                                    className={`bg-white border rounded-lg p-3 hover:shadow-md transition-all cursor-pointer group relative ${selectedIds.has(t.id) ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200'}`}
                                                    onClick={() => {
                                                        if (mode === 'select' && onSelect) {
                                                            onSelect(t);
                                                        } else {
                                                            toggleSelection(t.id);
                                                        }
                                                    }}
                                                >
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: t.color }}>
                                                                <Tag size={16} />
                                                            </div>
                                                            <div>
                                                                <h4 className="font-bold text-slate-800 text-sm">{t.label}</h4>
                                                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded">{t.type}</span>
                                                                    <span>{t.unit}</span>
                                                                    {t.group && <span className="text-slate-400">• {t.group}</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {mode === 'manage' && (
                                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleEditTemplate(t); }}
                                                                    className="text-slate-300 hover:text-blue-500 p-1"
                                                                    title="Edit Template"
                                                                >
                                                                    <Edit2 size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteRequest(t.id); }}
                                                                    className="text-slate-300 hover:text-red-500 p-1"
                                                                    title="Delete Template"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {mode === 'select' && (
                                                            <div className="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs font-bold opacity-0 group-hover:opacity-100">
                                                                Use
                                                            </div>
                                                        )}
                                                    </div>
                                                    {(t.formula !== 'Qty' || (t.properties && t.properties.length > 0)) && (
                                                        <div className="mt-2 pt-2 border-t border-slate-50 text-[10px] text-slate-400 font-mono flex gap-2 overflow-hidden">
                                                            {t.formula !== 'Qty' && <span>ƒ: {t.formula}</span>}
                                                            {t.price && <span>Price: ${t.price}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {mode === 'manage' && selectedIds.size > 0 && (
                <div className="p-3 bg-blue-50 border-t border-blue-100 flex justify-between items-center text-sm text-blue-800">
                    <span>{selectedIds.size} templates selected</span>
                    <button onClick={handleExport} className="font-bold hover:underline">Export Selected</button>
                </div>
            )}

            <ConfirmModal
                isOpen={showDeleteConfirm}
                title="Delete Template?"
                message="Are you sure you want to delete this template? This action cannot be undone."
                onConfirm={handleDeleteConfirmed}
                onCancel={() => setShowDeleteConfirm(false)}
                confirmText="Delete"
                isDestructive
            />

            <PromptModal
                isOpen={showNewGroupModal}
                title="Create New Template Group"
                message="Enter a name for the new template group."
                placeholder="e.g. Electrical"
                onConfirm={handleConfirmNewGroup}
                onCancel={() => setShowNewGroupModal(false)}
                confirmText="Create Group"
            />

            <NewTemplateModal
                isOpen={showNewTemplateModal}
                onClose={() => setShowNewTemplateModal(false)}
                onNext={handleNextStepCreate}
            />

            {editingTemplateItem && (
                <PropertiesModal
                    item={editingTemplateItem}
                    items={[]} // No other items needed for template context usually
                    onSave={handleSaveProperties}
                    onClose={() => setEditingTemplateItem(null)}
                />
            )}
        </div>
    );
};

export default TemplateManager;