import React from 'react';
import { ItemTemplate } from '../types';
import { Package, ShoppingCart, Crown, Edit2, Trash2, Check, X, Lock, Ruler } from 'lucide-react';

interface TemplateCardViewerProps {
    template: ItemTemplate | null;
    isOpen: boolean;
    onClose: () => void;
    onSelect?: (template: ItemTemplate) => void;
    onEdit?: (template: ItemTemplate) => void;
    onDelete?: (id: string) => void;
    isPremium?: boolean;
    hasPremiumAccess?: boolean;
    mode?: 'manage' | 'select';
}

const TemplateCardViewer: React.FC<TemplateCardViewerProps> = ({ 
    template, 
    isOpen, 
    onClose, 
    onSelect, 
    onEdit, 
    onDelete, 
    isPremium = false, 
    hasPremiumAccess = false,
    mode = 'manage'
}) => {
    if (!isOpen || !template) return null;

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    className="px-5 py-4 text-white relative shrink-0"
                    style={{ backgroundColor: template.color }}
                >
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 p-1.5 rounded-full bg-black/10 hover:bg-black/20 text-white transition-colors"
                    >
                        <X size={16} />
                    </button>

                    <div className="flex items-start justify-between pr-8">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="bg-white/20 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                                    {isPremium && <Crown size={10} className="text-yellow-300 fill-yellow-300" />}
                                    {template.type}
                                </span>
                                <span className="bg-white/20 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                    {template.unit}
                                </span>
                            </div>
                            <h2 className="text-xl font-bold mb-0.5">{template.label}</h2>
                            <p className="text-white/90 font-medium text-sm">{template.group}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-5 overflow-y-auto">
                    {/* Properties Section */}
                    <div className="mb-5">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Package size={14} />
                            Properties
                        </h3>
                        {template.properties && template.properties.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                                {template.properties.map((prop, idx) => (
                                    <div key={idx} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                                        <p className="text-[10px] uppercase text-slate-500 font-bold mb-0.5">{prop.name}</p>
                                        <p className="font-semibold text-slate-900 text-sm">{prop.value}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-slate-400 italic text-xs">No custom properties defined.</div>
                        )}
                    </div>

                    {/* Sub-Items Section */}
                    <div className="mb-5">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <ShoppingCart size={14} />
                            Included Line Items
                        </h3>
                        {template.subItems && template.subItems.length > 0 ? (
                            <div className="space-y-2">
                                {template.subItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors"
                                    >
                                        <div className="min-w-0 flex-1 mr-3">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <h4 className="font-bold text-slate-900 text-sm truncate" title={item.label}>{item.label}</h4>
                                                <span className="font-bold text-green-600 text-sm">${item.price.toFixed(2)}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                                                <span>{item.unit}</span>
                                                <span className="font-mono bg-slate-200 px-1 py-0.5 rounded max-w-[150px] truncate" title={item.formula}>
                                                    {item.formula}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-slate-400 italic text-xs">No sub-items included.</div>
                        )}
                    </div>

                    {/* Formula Info */}
                    {template.formula && template.formula !== 'Qty' && (
                        <div className="mb-4">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                <Ruler size={14} />
                                Base Formula
                            </h3>
                            <div className="bg-slate-900 text-slate-200 font-mono text-xs p-3 rounded-lg">
                                {template.formula}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 flex gap-2 justify-end">
                    {mode === 'select' ? (
                        <>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg font-bold text-sm text-slate-600 hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            {isPremium && !hasPremiumAccess ? (
                                <button
                                    disabled
                                    className="px-5 py-2 rounded-lg font-bold text-sm bg-slate-200 text-slate-400 cursor-not-allowed flex items-center gap-1.5"
                                >
                                    <Lock size={14} /> Premium Locked
                                </button>
                            ) : (
                                <button
                                    onClick={() => {
                                        if (onSelect) onSelect(template);
                                        onClose();
                                    }}
                                    className="px-5 py-2 rounded-lg font-bold text-sm bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-md hover:shadow-lg flex items-center gap-1.5"
                                >
                                    <Check size={14} /> Use Template
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            {!isPremium && onDelete && (
                                <button
                                    onClick={() => {
                                        onDelete(template.id);
                                        onClose();
                                    }}
                                    className="px-4 py-2 rounded-lg font-bold text-sm text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all flex items-center gap-1.5 mr-auto"
                                >
                                    <Trash2 size={14} /> Delete
                                </button>
                            )}
                            
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg font-bold text-sm text-slate-600 hover:bg-slate-200 transition-colors"
                            >
                                Close
                            </button>

                            {/* Edit Button - Only for Local or Copy for Premium */}
                            {onEdit && (
                                <button
                                    onClick={() => {
                                        onEdit(template);
                                        onClose(); // Close viewer when opening edit modal
                                    }}
                                    className="px-5 py-2 rounded-lg font-bold text-sm bg-white border border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600 transition-all flex items-center gap-1.5"
                                >
                                    <Edit2 size={14} /> {isPremium ? 'Copy & Edit' : 'Edit'}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TemplateCardViewer;