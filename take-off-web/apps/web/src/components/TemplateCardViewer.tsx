import React from 'react';
import { ItemTemplate } from '../types';
import { Package, ShoppingCart, Crown, Edit2, Trash2, Check, X, Lock, Ruler } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

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
    if (!template) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="p-0 overflow-hidden max-w-lg gap-0 border-0 outline-none">
                {/* Header */}
                <div
                    className="px-6 py-5 text-white relative shrink-0"
                    style={{ backgroundColor: template.color }}
                >
                    <DialogTitle className="sr-only">{template.label}</DialogTitle>
                    <DialogDescription className="sr-only">Template details for {template.label}</DialogDescription>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="absolute top-2 right-2 text-white hover:bg-black/20 hover:text-white rounded-full h-8 w-8"
                    >
                        <X size={16} />
                    </Button>

                    <div className="flex items-start justify-between pr-8">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Badge variant="secondary" className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border-0 text-[10px] font-bold uppercase tracking-wider gap-1 pl-1.5">
                                    {isPremium && <Crown size={10} className="text-yellow-300 fill-yellow-300" />}
                                    {template.type}
                                </Badge>
                                <Badge variant="secondary" className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border-0 text-[10px] font-bold uppercase tracking-wider">
                                    {template.unit}
                                </Badge>
                            </div>
                            <h2 className="text-xl font-bold mb-0.5">{template.label}</h2>
                            <p className="text-white/90 font-medium text-sm">{template.group}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex flex-col max-h-[60vh]">
                    <div className="p-6 overflow-y-auto">
                        {/* Properties Section */}
                        <div className="mb-6">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <Package size={14} />
                                Properties
                            </h3>
                            {template.properties && template.properties.length > 0 ? (
                                <div className="grid grid-cols-2 gap-3">
                                    {template.properties.map((prop, idx) => (
                                        <div key={idx} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
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
                        <div className="mb-6">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <ShoppingCart size={14} />
                                Included Line Items
                            </h3>
                            {template.subItems && template.subItems.length > 0 ? (
                                <div className="space-y-2">
                                    {template.subItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors"
                                        >
                                            <div className="min-w-0 flex-1 mr-4">
                                                <div className="flex items-center justify-between mb-1">
                                                    <h4 className="font-bold text-slate-900 text-sm truncate" title={item.label}>{item.label}</h4>
                                                    <span className="font-bold text-green-600 text-sm">${item.price.toFixed(2)}</span>
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                                    <span>{item.unit}</span>
                                                    <span className="font-mono bg-slate-200 px-1.5 py-0.5 rounded max-w-[150px] truncate" title={item.formula}>
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
                            <div className="mb-2">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Ruler size={14} />
                                    Base Formula
                                </h3>
                                <div className="bg-slate-900 text-slate-200 font-mono text-xs p-3 rounded-lg">
                                    {template.formula}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
                    {mode === 'select' ? (
                        <>
                            <Button variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            {isPremium && !hasPremiumAccess ? (
                                <Button
                                    variant="secondary"
                                    disabled
                                    className="gap-1.5 opacity-80"
                                >
                                    <Lock size={14} /> Premium Locked
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => {
                                        if (onSelect) onSelect(template);
                                        onClose();
                                    }}
                                    className="gap-1.5"
                                >
                                    <Check size={14} /> Use Template
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            {!isPremium && onDelete && (
                                <Button
                                    variant="destructive"
                                    onClick={() => {
                                        onDelete(template.id);
                                        onClose();
                                    }}
                                    className="gap-1.5 mr-auto"
                                >
                                    <Trash2 size={14} /> Delete
                                </Button>
                            )}

                            <Button variant="outline" onClick={onClose}>
                                Close
                            </Button>

                            {/* Edit Button - Only for Local or Copy for Premium */}
                            {onEdit && (
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        onEdit(template);
                                        onClose();
                                    }}
                                    className="gap-1.5 border-slate-200 hover:border-blue-500 hover:text-blue-600"
                                >
                                    <Edit2 size={14} /> {isPremium ? 'Copy & Edit' : 'Edit'}
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default TemplateCardViewer;