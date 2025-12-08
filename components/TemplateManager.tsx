import React, { useState, useEffect, useRef } from 'react';
import { ItemTemplate, ToolType, Unit, TakeoffItem } from '../types';
import { getTemplates, deleteTemplate, exportTemplatesToJSON, importTemplatesFromJSON, saveTemplate } from '../utils/storage';
import { Trash2, Download, Upload, Plus, Search, Tag, Edit2, Folder, FolderOpen, ChevronDown, ChevronRight, GripVertical, Crown, Lock, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { templateService } from '../services/templateService';
import { licenseService } from '../services/licenseService';
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

    // Tab Management
    const [activeTab, setActiveTab] = useState<'local' | 'premium'>('local');

    // Premium Templates State
    const [premiumTemplates, setPremiumTemplates] = useState<ItemTemplate[]>([]);
    const [isPremiumLoading, setIsPremiumLoading] = useState(false);
    const [hasPremiumAccess, setHasPremiumAccess] = useState(false);
    const [premiumError, setPremiumError] = useState<string | null>(null);
    const [premiumCategories, setPremiumCategories] = useState<string[]>([]);
    const [collapsedPremiumCategories, setCollapsedPremiumCategories] = useState<Set<string>>(new Set());

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

    const loadPremiumTemplates = async () => {
        setIsPremiumLoading(true);
        setPremiumError(null);

        const response = await templateService.fetchPremiumTemplates();

        if (response.success && response.templates) {
            setPremiumTemplates(response.templates);
            setHasPremiumAccess(true);

            // Extract unique categories from premium templates
            const categories = new Set(response.templates.map(t => t.group || 'General').filter(Boolean));
            setPremiumCategories(Array.from(categories).sort());
        } else {
            setPremiumError(response.message || 'Failed to load premium templates');
            setHasPremiumAccess(!response.requiresUpgrade);
        }

        setIsPremiumLoading(false);
    };

    useEffect(() => {
        load();
        // Check premium access on mount
        templateService.hasPremiumAccess().then(setHasPremiumAccess);
    }, []);

    useEffect(() => {
        if (activeTab === 'premium' && premiumTemplates.length === 0 && !premiumError) {
            loadPremiumTemplates();
        }
    }, [activeTab]);

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

    const togglePremiumCategory = (category: string) => {
        setCollapsedPremiumCategories(prev => {
            const newSet = new Set(prev);
            if (newSet.has(category)) {
                newSet.delete(category);
            } else {
                newSet.add(category);
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
            {/* Header with Tabs */}
            <div className="bg-white border-b">
                <div className="flex border-b border-slate-200">
                    <button
                        onClick={() => setActiveTab('local')}
                        className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${activeTab === 'local'
                            ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                            }`}
                    >
                        My Templates
                    </button>
                    <button
                        onClick={() => setActiveTab('premium')}
                        className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${activeTab === 'premium'
                            ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                            }`}
                    >
                        <Crown size={16} className="text-purple-600" />
                        Premium Templates
                    </button>
                </div>

                <div className="p-4 flex justify-between items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            className="w-full pl-9 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-900"
                            placeholder="Search templates..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {activeTab === 'local' && (
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
                    )}
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'local' ? (
                    /* Local Templates Content */
                    groups.length === 0 ? (
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
                    )
                ) : (
                    /* Premium Templates Content */
                    <div className="p-4">
                        {!hasPremiumAccess ? (
                            /* Upgrade Prompt */
                            <div className="max-w-md mx-auto mt-12 text-center">
                                <div className="bg-gradient-to-br from-purple-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                                    <Lock className="text-purple-600" size={40} />
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 mb-2">Premium Templates Locked</h3>
                                <p className="text-slate-600 mb-6">
                                    Upgrade to a paid license to access our curated library of professional templates.
                                </p>
                                <div className="bg-white rounded-lg p-6 shadow-sm border border-slate-200 mb-6">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Crown className="text-purple-600" size={20} />
                                        <h4 className="font-semibold text-slate-900">What's Included:</h4>
                                    </div>
                                    <ul className="text-left text-sm text-slate-600 space-y-2">
                                        <li className="flex items-start gap-2">
                                            <span className="text-green-600 mt-0.5">✓</span>
                                            <span>Pre-built templates for common construction items</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-green-600 mt-0.5">✓</span>
                                            <span>Advanced formulas and calculations</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-green-600 mt-0.5">✓</span>
                                            <span>Regular updates with new templates</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-green-600 mt-0.5">✓</span>
                                            <span>Lifetime access with paid license</span>
                                        </li>
                                    </ul>
                                </div>
                                <button
                                    onClick={() => window.open('#', '_blank')}
                                    className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-blue-700 transition-all shadow-lg"
                                >
                                    Upgrade to Paid License
                                </button>
                            </div>
                        ) : isPremiumLoading ? (
                            /* Loading State */
                            <div className="flex flex-col items-center justify-center py-12">
                                <Loader2 className="text-purple-600 animate-spin mb-4" size={48} />
                                <p className="text-slate-600">Loading premium templates...</p>
                            </div>
                        ) : premiumError ? (
                            /* Error State */
                            <div className="max-w-md mx-auto mt-12 text-center">
                                <AlertCircle className="text-red-500 mx-auto mb-4" size={48} />
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">Failed to Load Templates</h3>
                                <p className="text-slate-600 mb-4">{premiumError}</p>
                                <button
                                    onClick={loadPremiumTemplates}
                                    className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : premiumTemplates.length === 0 ? (
                            /* Empty State */
                            <div className="text-center py-12 text-slate-400">
                                <Crown className="mx-auto mb-4" size={48} />
                                <p>No premium templates available yet.</p>
                            </div>
                        ) : (
                            /* Premium Templates Grouped by Category */
                            <div>
                                {premiumCategories.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400 italic">
                                        No premium templates available yet.
                                    </div>
                                ) : (
                                    premiumCategories.map(category => {
                                        const categoryTemplates = premiumTemplates
                                            .filter(t => {
                                                if ((t.group || 'General') !== category) return false;
                                                if (filterToolType && t.type !== filterToolType) return false;
                                                if (searchTerm) {
                                                    const lower = searchTerm.toLowerCase();
                                                    return t.label.toLowerCase().includes(lower) || t.group?.toLowerCase().includes(lower);
                                                }
                                                return true;
                                            });
                                        const isCollapsed = collapsedPremiumCategories.has(category);

                                        return (
                                            <div key={category} className="border-b border-purple-100 last:border-0">
                                                {/* Category Header */}
                                                <div className="bg-purple-50 px-4 py-3 flex items-center justify-between hover:bg-purple-100 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => togglePremiumCategory(category)}
                                                            className="p-1 hover:bg-purple-200 rounded text-purple-400 transition-colors"
                                                        >
                                                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                                        </button>
                                                        <div className="flex items-center gap-2">
                                                            <Crown size={14} className="text-purple-600" />
                                                            <span className="font-semibold text-purple-900 text-sm">{category}</span>
                                                        </div>
                                                        <span className="text-xs bg-purple-200 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                                            {categoryTemplates.length} templates
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Category Templates */}
                                                {!isCollapsed && (
                                                    <div className="p-3 space-y-2 bg-white">
                                                        {categoryTemplates.length === 0 ? (
                                                            <div className="text-center text-slate-400 text-sm italic py-4">
                                                                No templates in this category.
                                                            </div>
                                                        ) : (
                                                            categoryTemplates.map(t => (
                                                                <div
                                                                    key={t.id}
                                                                    className="bg-white border border-purple-100 rounded-lg p-3 hover:shadow-md hover:border-purple-300 transition-all cursor-pointer group relative"
                                                                    onClick={() => {
                                                                        if (mode === 'select' && onSelect) {
                                                                            onSelect(t);
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
                                                                                    <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold">PREMIUM</span>
                                                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded">{t.type}</span>
                                                                                    <span>{t.unit}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        {mode === 'select' && (
                                                                            <div className="text-purple-600 bg-purple-50 px-2 py-1 rounded text-xs font-bold opacity-0 group-hover:opacity-100">
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
                        )}
                    </div>
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