import React, { useState, useEffect, useRef } from 'react';
import { ItemTemplate, ToolType, Unit, TakeoffItem } from '../types';
import { getTemplates, deleteTemplate, exportTemplatesToJSON, importTemplatesFromJSON, saveTemplate } from '../utils/storage';
import { Trash2, Download, Upload, Plus, Search, Tag, Edit2, Folder, FolderOpen, ChevronDown, ChevronRight, GripVertical, Crown, Lock, Loader2, AlertCircle, Package, ShoppingCart, Check, LayoutGrid } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { templateService } from '../services/templateService';
import ConfirmModal from './ConfirmModal';
import PromptModal from './PromptModal';
import NewTemplateModal from './NewTemplateModal';
import PropertiesModal from './PropertiesModal';
import TemplateCardViewer from './TemplateCardViewer';

interface TemplateManagerProps {
    mode?: 'manage' | 'select';
    filterToolType?: ToolType;
    onSelect?: (template: ItemTemplate) => void;
    onClose?: () => void;
}

const TemplateManager: React.FC<TemplateManagerProps> = ({ mode = 'manage', filterToolType, onSelect }) => {
    const { addToast } = useToast();
    const [localTemplates, setLocalTemplates] = useState<ItemTemplate[]>([]);
    const [premiumTemplates, setPremiumTemplates] = useState<ItemTemplate[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const templatesListRef = useRef<HTMLDivElement>(null);

    // Categories (Trades) State
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [categories, setCategories] = useState<string[]>(['All']);

    // Premium Access State
    const [isPremiumLoading, setIsPremiumLoading] = useState(false);
    const [hasPremiumAccess, setHasPremiumAccess] = useState(false);
    const [premiumError, setPremiumError] = useState<string | null>(null);

    // Group Management (renaming, etc.)
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

    // Template Viewer State
    const [viewingTemplate, setViewingTemplate] = useState<ItemTemplate | null>(null);

    // Load Local Templates
    const loadLocal = async () => {
        const data = await getTemplates();
        setLocalTemplates(data.sort((a, b) => b.createdAt - a.createdAt));
    };

    // Load Premium Templates
    const loadPremium = async () => {
        setIsPremiumLoading(true);
        setPremiumError(null);

        const response = await templateService.fetchPremiumTemplates();

        if (response.success && response.templates) {
            setPremiumTemplates(response.templates);
            setHasPremiumAccess(true);
        } else {
            setPremiumError(response.message || 'Failed to load premium templates');
            setHasPremiumAccess(!response.requiresUpgrade);
        }

        setIsPremiumLoading(false);
    };

    // Initial Load
    useEffect(() => {
        loadLocal();
        loadPremium();
        templateService.hasPremiumAccess().then(setHasPremiumAccess);
    }, []);

    // Combine Templates & Extract Categories
    // Use a Map to deduplicate by ID, preferring local templates if they override premium ones
    const allTemplatesMap = new Map<string, ItemTemplate>();
    
    // Add premium templates first
    premiumTemplates.forEach(t => allTemplatesMap.set(t.id, t));
    
    // Add local templates, potentially overwriting premium ones with same ID
    localTemplates.forEach(t => allTemplatesMap.set(t.id, t));
    
    const allTemplates = Array.from(allTemplatesMap.values());

    useEffect(() => {
        const uniqueGroups = new Set(allTemplates.map(t => t.group || 'General').filter(Boolean));
        // Ensure "All" is first, then alphabetical
        const sortedGroups = Array.from(uniqueGroups).sort();
        setCategories(['All', ...sortedGroups]);
    }, [localTemplates, premiumTemplates]);


    const handleDeleteRequest = (id: string) => {
        setTemplateToDelete(id);
        setShowDeleteConfirm(true);
    };

    const handleDeleteConfirmed = async () => {
        if (templateToDelete) {
            await deleteTemplate(templateToDelete);
            loadLocal();
            addToast("Template deleted", 'info');
        }
        setShowDeleteConfirm(false);
        setTemplateToDelete(null);
    };

    const handleExport = async () => {
        const toExport = selectedIds.size > 0
            ? localTemplates.filter(t => selectedIds.has(t.id))
            : localTemplates;

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
                loadLocal();
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
    const filteredTemplates = allTemplates.filter(t => {
        // Filter by Tool Type (if provided)
        if (filterToolType && t.type !== filterToolType) return false;

        // Filter by Search Term
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            if (!t.label.toLowerCase().includes(lower) && !t.group?.toLowerCase().includes(lower)) {
                return false;
            }
        }

        // Filter by Selected Category
        const templateGroup = t.group || 'General';
        if (selectedCategory !== 'All' && templateGroup !== selectedCategory) {
            return false;
        }

        return true;
    });

    // Scroll to top when category changes
    useEffect(() => {
        if (templatesListRef.current) {
            templatesListRef.current.scrollTop = 0;
        }
    }, [selectedCategory, searchTerm]);

    const handleConfirmNewGroup = (name: string) => {
        // This is a bit tricky since groups are derived from templates.
        // We'll just add it to the dropdown effectively when a template is assigned to it.
        // For now, we can perhaps just toast or handle it if we want to pre-create empty groups?
        // But the current architecture derives groups from existing templates.
        // So maybe we just select it?
        // Let's just create a dummy template? No, that's messy.
        // The previous implementation added it to state but it disappeared on reload if empty.
        // We will just let the user know they can use it when creating a template.
        setShowNewGroupModal(false);
        addToast("To use this new group, create or edit a template and assign it.", 'info');
    };
    
    // Edit Template / Properties Logic
    const handleEditTemplate = (template: ItemTemplate) => {
        // Check if it's a local template (premium ones might be read-only or copy-on-edit)
        // For simplicity, we allow editing local ones directly.
        // Premium ones should probably be "copied" to local if edited?
        // Let's assume for now we only edit local.
        const isLocal = localTemplates.some(t => t.id === template.id);
        
        if (!isLocal) {
             // Create a copy for editing
            const tempItem: TakeoffItem = {
                ...template,
                id: crypto.randomUUID(), // New ID for the copy
                label: `${template.label} (Copy)`,
                totalValue: 100,
                shapes: [],
                visible: true,
                group: template.group || 'General' // Keep group
            };
            setEditingTemplateItem(tempItem);
            setIsCreatingNew(true); // Treat as new
            addToast("Creating a copy of premium template", 'info');
        } else {
            const tempItem: TakeoffItem = {
                ...template,
                totalValue: 100,
                shapes: [],
                visible: true,
                group: template.group || 'General'
            };
            setEditingTemplateItem(tempItem);
            setIsCreatingNew(false);
        }
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
            unit: Unit.EACH,
            totalValue: 100,
            price: 0,
            formula: 'Qty',
            properties: [],
            subItems: [],
            group: selectedCategory !== 'All' ? selectedCategory : 'General',
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
            type: editingTemplateItem.type,
            color: updates.color || editingTemplateItem.color,
            unit: updates.unit || editingTemplateItem.unit,
            price: updates.price,
            formula: updates.formula || editingTemplateItem.formula,
            properties: updates.properties || editingTemplateItem.properties,
            subItems: updates.subItems || editingTemplateItem.subItems,
            group: updates.group || editingTemplateItem.group || 'General',
            createdAt: isCreatingNew ? Date.now() : (localTemplates.find(t => t.id === id)?.createdAt || Date.now())
        };

        await saveTemplate(templateData);
        addToast(isCreatingNew ? "Template created" : "Template updated", 'success');
        setEditingTemplateItem(null);
        loadLocal();
    };

    const renderTemplateCard = (t: ItemTemplate) => {
        const isPremium = premiumTemplates.some(pt => pt.id === t.id);

        return (
            <div
                key={t.id}
                onClick={() => setViewingTemplate(t)}
                className={`border rounded-xl overflow-hidden transition-all duration-200 bg-white hover:scale-[1.01] cursor-pointer group flex ${selectedIds.has(t.id) ? 'border-blue-500 ring-1 ring-blue-500 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'}`}
            >
                {/* Color Strip */}
                <div className="w-4 shrink-0" style={{ backgroundColor: t.color }}></div>

                {/* Content */}
                <div className="flex-1 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 overflow-hidden">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-bold text-slate-900 truncate" title={t.label}>{t.label}</h3>
                                {isPremium && <Crown size={14} className="text-yellow-500 fill-yellow-500" />}
                            </div>
                            <p className="text-sm text-slate-500 font-medium truncate">{t.group}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                         <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 px-2 py-1 rounded">
                            <span className="font-semibold">{t.unit}</span>
                         </div>
                         <div className="bg-slate-100 px-2 py-1 rounded text-xs font-bold uppercase tracking-wider text-slate-500">
                            {t.type}
                        </div>
                         <div className="text-slate-300 group-hover:text-blue-500 transition-colors">
                            <ChevronRight size={20} />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-slate-100 rounded-lg overflow-hidden">
            {/* LEFT SIDEBAR - TRADES (CATEGORIES) */}
            <div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
                <div className="p-4 border-b border-slate-100">
                    <h2 className="font-bold text-slate-800 flex items-center gap-2">
                        <LayoutGrid size={18} className="text-blue-600" />
                        Trades
                    </h2>
                </div>
                
                {/* Search in Sidebar */}
                <div className="p-3">
                     <div className="relative">
                        <Search className="absolute left-2.5 top-2 text-slate-400" size={14} />
                        <input
                            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none text-slate-900 placeholder:text-slate-400"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {categories.map(category => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`w-full text-left px-4 py-2.5 text-sm font-medium border-l-4 transition-all hover:bg-slate-50 ${
                                selectedCategory === category 
                                    ? 'border-blue-600 text-blue-700 bg-blue-50/50' 
                                    : 'border-transparent text-slate-600'
                            }`}
                        >
                            <div className="flex justify-between items-center">
                                <span className="truncate">{category}</span>
                                <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                                    {category === 'All' 
                                        ? allTemplates.length 
                                        : allTemplates.filter(t => (t.group || 'General') === category).length
                                    }
                                </span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Sidebar Actions */}
                {mode === 'manage' && (
                    <div className="p-3 border-t border-slate-100 bg-slate-50">
                        <button 
                            onClick={handleCreateTemplate}
                            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white py-2 rounded text-sm font-medium transition-colors shadow-sm"
                        >
                            <Plus size={16} /> New Template
                        </button>
                        <div className="flex gap-2 mt-2">
                            <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded hover:bg-white transition-colors">
                                Import
                            </button>
                            <button onClick={handleExport} className="flex-1 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded hover:bg-white transition-colors">
                                Export
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                        </div>
                    </div>
                )}
            </div>

            {/* RIGHT CONTENT - TEMPLATES GRID */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50">
                <div className="p-5 flex-1 overflow-y-auto" ref={templatesListRef}>
                    {/* Header Info */}
                    <div className="flex justify-between items-end mb-6">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900">{selectedCategory === 'All' ? 'All Templates' : selectedCategory}</h2>
                            <p className="text-slate-500 text-sm mt-1">
                                Showing {filteredTemplates.length} templates
                            </p>
                        </div>
                    </div>

                    {filteredTemplates.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                                <Search className="text-slate-400" size={24} />
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900 mb-1">No templates found</h3>
                            <p className="text-slate-500 max-w-xs mx-auto">
                                Try adjusting your search or category filter, or create a new template.
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {filteredTemplates.map(t => renderTemplateCard(t))}
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
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
                    items={[]}
                    onSave={handleSaveProperties}
                    onClose={() => setEditingTemplateItem(null)}
                />
            )}

            <TemplateCardViewer
                template={viewingTemplate}
                isOpen={!!viewingTemplate}
                onClose={() => setViewingTemplate(null)}
                onSelect={onSelect}
                onEdit={handleEditTemplate}
                onDelete={handleDeleteRequest}
                isPremium={premiumTemplates.some(pt => pt.id === viewingTemplate?.id)}
                hasPremiumAccess={hasPremiumAccess}
                mode={mode}
            />
        </div>
    );
};

export default TemplateManager;