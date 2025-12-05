import React, { useState } from 'react';
import { ToolType } from '../types';
import { generateColor } from '../utils/geometry';
import { Tag, X } from 'lucide-react';

interface NewTemplateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNext: (name: string, type: ToolType, color: string) => void;
}

const NewTemplateModal: React.FC<NewTemplateModalProps> = ({ isOpen, onClose, onNext }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<ToolType>(ToolType.AREA);
    const [color, setColor] = useState(generateColor(0));

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onNext(name.trim(), type, color);
            // Reset form
            setName('');
            setType(ToolType.AREA);
            setColor(generateColor(0));
        }
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <Tag size={18} /> New Template
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Template Name</label>
                        <input
                            autoFocus
                            className="border border-slate-200 px-3 py-2 w-full rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. 2x4 Wall"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tool Type</label>
                        <select
                            value={type}
                            onChange={e => setType(e.target.value as ToolType)}
                            className="border border-slate-200 px-3 py-2 w-full rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-slate-900 transition-all"
                        >
                            {Object.values(ToolType).map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2">Default Color</label>
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

                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="text-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium shadow-sm transition-all"
                        >
                            Next
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NewTemplateModal;
