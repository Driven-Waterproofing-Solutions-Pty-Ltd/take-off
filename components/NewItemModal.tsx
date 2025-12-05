
import React, { useState } from 'react';
import { TakeoffItem, ToolType } from '../types';
import { generateColor } from '../utils/geometry';
import TemplateManager from './TemplateManager';
import { Tag, Edit3 } from 'lucide-react';

interface NewItemModalProps {
    toolType: ToolType;
    existingCount: number;
    onCreate: (data: Partial<TakeoffItem>) => void;
    onCancel: () => void;
}

const NewItemModal: React.FC<NewItemModalProps> = ({ toolType, existingCount, onCreate, onCancel }) => {
    const [activeTab, setActiveTab] = useState<'basic' | 'template'>('basic');

    // Basic Form State
    const [name, setName] = useState(`${toolType.charAt(0) + toolType.slice(1).toLowerCase()} ${existingCount + 1}`);
    const [color, setColor] = useState(generateColor(existingCount));

    const handleBasicSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onCreate({ label: name, color });
        }
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-[450px] overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
                <div className="flex border-b border-slate-100">
                    <button
                        className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-all ${activeTab === 'basic' ? 'border-slate-900 text-slate-900 bg-slate-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/30'}`}
                        onClick={() => setActiveTab('basic')}
                    >
                        <Edit3 size={14} /> Basic
                    </button>
                    <button
                        className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-all ${activeTab === 'template' ? 'border-slate-900 text-slate-900 bg-slate-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/30'}`}
                        onClick={() => setActiveTab('template')}
                    >
                        <Tag size={14} /> From Template
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {activeTab === 'basic' ? (
                        <form onSubmit={handleBasicSubmit} className="p-5">
                            <h3 className="font-semibold mb-4 text-lg text-slate-900">New Takeoff Item</h3>
                            <div className="mb-4">
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Name</label>
                                <input
                                    autoFocus
                                    className="border border-slate-200 px-3 py-2 w-full rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                />
                            </div>

                            <div className="mb-5">
                                <label className="block text-xs font-semibold text-slate-600 mb-2">Color</label>
                                <div className="flex gap-2 flex-wrap">
                                    {[
                                        '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
                                        '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
                                    ].map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setColor(c)}
                                            className={`w-7 h-7 rounded-lg border-2 transition-all ${color === c ? 'border-slate-900 scale-110 shadow-md' : 'border-slate-200 hover:border-slate-400'}`}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-3">
                                <button type="button" onClick={onCancel} className="text-slate-600 px-4 py-1.5 text-sm font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                                <button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-1.5 rounded-lg text-sm font-medium shadow-sm transition-all">Create Item</button>
                            </div>
                        </form>
                    ) : (
                        <div className="h-96 flex flex-col">
                            <div className="px-5 pt-4 pb-3">
                                <h3 className="font-semibold text-lg text-slate-900">Select Template</h3>
                                <p className="text-xs text-slate-500 mt-0.5">Showing templates compatible with {toolType} tool.</p>
                            </div>
                            <div className="flex-1 overflow-hidden px-2">
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
                            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
                                <button type="button" onClick={onCancel} className="text-slate-600 px-4 py-1.5 text-sm font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NewItemModal;
