import React, { useState } from 'react';
import { PlanSet, ProjectData } from '../types';
import { FileDown, Loader2 } from 'lucide-react';

interface ExportModalProps {
    planSets: PlanSet[];
    projectData: ProjectData;
    currentPageIndex: number;
    isOpen: boolean;
    isExporting: boolean;
    progress?: { current: number, total: number };
    onClose: () => void;
    onExport: (pageIndices: number[], includeLegend: boolean, includeNotes: boolean) => void;
}

const ExportModal: React.FC<ExportModalProps> = ({
    planSets,
    projectData,
    currentPageIndex,
    isOpen,
    isExporting,
    progress,
    onClose,
    onExport
}) => {
    const [mode, setMode] = useState<'current' | 'all' | 'custom'>('current');
    const [includeLegend, setIncludeLegend] = useState(true);
    const [includeNotes, setIncludeNotes] = useState(true);
    const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set([currentPageIndex]));

    if (!isOpen) return null;

    const getAllPageIndices = () => {
        const indices: number[] = [];
        planSets.forEach(plan => {
            for (let i = 0; i < plan.pageCount; i++) {
                indices.push(plan.startPageIndex + i);
            }
        });
        return indices.sort((a, b) => a - b);
    };

    const handleExport = () => {
        let indices: number[] = [];
        if (mode === 'current') {
            indices = [currentPageIndex];
        } else if (mode === 'all') {
            indices = getAllPageIndices();
        } else {
            indices = Array.from<number>(selectedPages).sort((a, b) => a - b);
        }

        onExport(indices, includeLegend, includeNotes);
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[100]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl w-[500px] flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <FileDown className="text-slate-700" size={20} /> Export Markup PDF
                    </h2>
                </div>

                <div className="p-6 flex-1 overflow-y-auto">
                    {isExporting ? (
                        <div className="flex flex-col items-center justify-center py-10 space-y-4">
                            <Loader2 size={48} className="text-slate-900 animate-spin" />
                            <div className="text-center">
                                <h3 className="font-semibold text-slate-900">Generating PDF...</h3>
                                {progress && (
                                    <p className="text-sm text-slate-500 mt-2">
                                        Processing page {progress.current} of {progress.total}
                                    </p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Scope Selection */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Export Scope</label>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${mode === 'current' ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                                        onClick={() => setMode('current')}
                                    >
                                        Current Page
                                    </button>
                                    <button
                                        className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${mode === 'all' ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                                        onClick={() => setMode('all')}
                                    >
                                        All Pages
                                    </button>
                                    <button
                                        className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${mode === 'custom' ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                                        onClick={() => setMode('custom')}
                                    >
                                        Select Pages
                                    </button>
                                </div>
                            </div>

                            {/* Custom Selection List */}
                            {mode === 'custom' && (
                                <div className="border border-slate-200 rounded-lg p-2 max-h-48 overflow-y-auto bg-slate-50">
                                    {planSets.map(plan => (
                                        <div key={plan.id} className="mb-2">
                                            <div className="text-xs font-bold text-slate-500 mb-1 uppercase px-2">{plan.name}</div>
                                            {Array.from({ length: plan.pageCount }).map((_, i) => {
                                                const globalIdx = plan.startPageIndex + i;
                                                const pageName = projectData[globalIdx]?.name || `Page ${i + 1}`;
                                                return (
                                                    <label key={globalIdx} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white rounded cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedPages.has(globalIdx)}
                                                            onChange={(e) => {
                                                                const newSet = new Set(selectedPages);
                                                                if (e.target.checked) newSet.add(globalIdx);
                                                                else newSet.delete(globalIdx);
                                                                setSelectedPages(newSet);
                                                            }}
                                                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                                        />
                                                        <span className="text-sm text-slate-700">{pageName}</span>
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Options */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Options</label>
                                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-white cursor-pointer hover:bg-slate-50">
                                    <input
                                        type="checkbox"
                                        checked={includeLegend}
                                        onChange={(e) => setIncludeLegend(e.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                    />
                                    <div>
                                        <span className="block text-sm font-medium text-slate-900">Include Item Legend</span>
                                        <span className="block text-xs text-slate-500">Adds a table with quantities to each page</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-white cursor-pointer hover:bg-slate-50">
                                    <input
                                        type="checkbox"
                                        checked={includeNotes}
                                        onChange={(e) => setIncludeNotes(e.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                    />
                                    <div>
                                        <span className="block text-sm font-medium text-slate-900">Include Notes</span>
                                        <span className="block text-xs text-slate-500">Adds text annotations to the PDF</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isExporting}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting || (mode === 'custom' && selectedPages.size === 0)}
                        className="px-6 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isExporting ? 'Generating...' : 'Export PDF'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExportModal;