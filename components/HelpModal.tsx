import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Keyboard, BookOpen, MousePointer2, Layers, FileText, Settings, Calculator, Package, FileDown, Save, Box, ShieldCheck, AlertTriangle, Crown, Key } from 'lucide-react';
import { licenseService } from '../services/licenseService';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'guide' | 'shortcuts' | 'properties' | 'license';
}

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, initialTab }) => {
    const [activeTab, setActiveTab] = useState<'guide' | 'shortcuts' | 'properties' | 'license'>('guide');
    const [licenseInfo, setLicenseInfo] = useState<{ valid: boolean; message: string; expiresAt?: string; licenseKey?: string; licenseType?: 'trial' | 'paid' } | null>(null);
    const [checkingLicense, setCheckingLicense] = useState(false);
    const [mounted, setMounted] = useState(false);

    const checkLicense = async () => {
        setCheckingLicense(true);
        try {
            const res = await licenseService.checkLicense();
            setLicenseInfo(res);
        } catch (e) {
            console.error(e);
        } finally {
            setCheckingLicense(false);
        }
    };

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab);
        }
    }, [initialTab, isOpen]);

    useEffect(() => {
        setMounted(true);
        if (isOpen && activeTab === 'license') {
            checkLicense();
        }
        return () => setMounted(false);
    }, [isOpen, activeTab]);

    if (!isOpen || !mounted) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >

                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <BookOpen size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">ProTakeoff Guide</h2>
                            <p className="text-xs text-slate-500">Documentation, Properties & Shortcuts</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200">
                            <img src="/prologo.svg" alt="ProTakeoff" className="w-9 h-9" />

                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-100 px-6">
                    <button
                        onClick={() => setActiveTab('guide')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'guide' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        <BookOpen size={16} /> User Manual
                    </button>
                    <button
                        onClick={() => setActiveTab('properties')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'properties' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        <Calculator size={16} /> Properties & Formulas
                    </button>
                    <button
                        onClick={() => setActiveTab('shortcuts')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'shortcuts' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        <Keyboard size={16} /> Keyboard Shortcuts
                    </button>
                    <button
                        onClick={() => setActiveTab('license')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'license' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        <ShieldCheck size={16} /> License
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">

                    {activeTab === 'guide' && (
                        <div className="space-y-8 max-w-4xl mx-auto">

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                    <Layers className="text-blue-500" size={24} /> Getting Started
                                </h3>
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 text-slate-600 leading-relaxed">
                                    <p>
                                        <strong>1. Create or Load a Project:</strong> Start by creating a new project or loading an existing `.takeoff` file using the folder icons in the sidebar.
                                    </p>
                                    <p>
                                        <strong>2. Upload Plans:</strong> Click the <span className="inline-flex items-center justify-center w-5 h-5 bg-slate-100 rounded text-slate-600 text-xs font-bold">+</span> icon in the sidebar to upload PDF plan sets. You can upload multiple files at once.
                                    </p>
                                    <p>
                                        <strong>3. Set Scale:</strong> Before measuring, you must set the scale for each page. Select the <strong>Scale Tool (S)</strong> and either:
                                        <ul className="list-disc pl-5 mt-2 space-y-1">
                                            <li>Choose a preset scale (e.g., 1/4" = 1') from the dropdown.</li>
                                            <li>Calibrate manually by measuring a known dimension on the plan.</li>
                                        </ul>
                                    </p>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                    <MousePointer2 className="text-green-500" size={24} /> Measurement Tools
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                                        <h4 className="font-bold text-slate-800 mb-2">Area (1)</h4>
                                        <p className="text-sm text-slate-600">Measure square footage. Click points to define a polygon. Press <strong>C</strong> to close and finish.</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                                        <h4 className="font-bold text-slate-800 mb-2">Linear (2)</h4>
                                        <p className="text-sm text-slate-600">Measure continuous lines (walls, curbing). Click points to trace. Double-click or press <strong>C</strong> to finish.</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                                        <h4 className="font-bold text-slate-800 mb-2">Segment (3)</h4>
                                        <p className="text-sm text-slate-600">Measure individual line segments (beams, headers). Click start and end points for each segment.</p>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                                        <h4 className="font-bold text-slate-800 mb-2">Count (4)</h4>
                                        <p className="text-sm text-slate-600">Count individual items (fixtures, outlets). Click to place a marker.</p>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                    <Settings className="text-purple-500" size={24} /> Advanced Features
                                </h3>
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 text-slate-600">
                                    <div className="flex gap-4">
                                        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg shrink-0 h-fit"><FileDown size={20} /></div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">Exporting</h4>
                                            <p className="text-sm mb-2">Click the <strong>Export</strong> button in the sidebar to generate a PDF.</p>
                                            <ul className="list-disc pl-4 text-sm space-y-1">
                                                <li><strong>Burn-in Markups:</strong> Your measurements will be visually drawn onto the PDF pages.</li>
                                                <li><strong>Scale:</strong> The PDF retains the original quality and scale.</li>
                                                <li><strong>Legend:</strong> A legend of items can be optionally added (future feature).</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <hr className="border-slate-100" />
                                    <div className="flex gap-4">
                                        <div className="p-2 bg-orange-50 text-orange-600 rounded-lg shrink-0 h-fit"><Save size={20} /></div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">Item Templates</h4>
                                            <p className="text-sm mb-2">Save frequently used items (like specific wall assemblies) as templates.</p>
                                            <ul className="list-disc pl-4 text-sm space-y-1">
                                                <li><strong>Save:</strong> In the Item Properties modal, click "Save as Template".</li>
                                                <li><strong>Reuse:</strong> When creating a new item, you can select from your saved templates (coming soon to the New Item modal).</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </section>

                        </div>
                    )}

                    {activeTab === 'properties' && (
                        <div className="space-y-8 max-w-4xl mx-auto">

                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
                                <Calculator className="text-blue-500 shrink-0 mt-0.5" size={20} />
                                <div className="text-sm text-blue-800">
                                    <p className="font-semibold mb-1">Power User Feature</p>
                                    <p>Use Properties and Sub-Items to build complex assemblies. Define variables and formulas to automatically calculate materials based on your measurements.</p>
                                </div>
                            </div>

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800">1. Item Properties</h3>
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-slate-600 space-y-4">
                                    <p>Right-click any item in the sidebar and select <strong>Properties</strong> to open the editor.</p>
                                    <ul className="list-disc pl-5 space-y-2">
                                        <li><strong>Name & Group:</strong> Organize your items.</li>
                                        <li><strong>Color:</strong> Change the visual appearance on the canvas.</li>
                                        <li><strong>Custom Variables:</strong> Add your own variables (e.g., "Wall Height", "Depth", "Waste %") to use in formulas.</li>
                                    </ul>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800">2. Sub-Items (Parts)</h3>
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-slate-600 space-y-4">
                                    <p>Sub-items allow you to break down a measurement into material lists. For example, a "Wall" linear measurement can generate sub-items for Studs, Drywall, and Insulation.</p>
                                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                        <h4 className="font-bold text-slate-700 mb-2">How to add Sub-Items:</h4>
                                        <ol className="list-decimal pl-5 space-y-1 text-sm">
                                            <li>Open Item Properties.</li>
                                            <li>Switch to the <strong>Sub-Items</strong> tab.</li>
                                            <li>Enter a Name (e.g., "2x4 Studs").</li>
                                            <li>Enter a Formula (e.g., `Qty / 1.33`).</li>
                                            <li>Click <strong>Add</strong>.</li>
                                        </ol>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800">3. Formulas & Variables</h3>
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-slate-600 space-y-4">
                                    <p>Formulas allow dynamic calculations. You can use standard math (`+`, `-`, `*`, `/`, `()`) and variables.</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <h4 className="font-bold text-slate-700 mb-2">Standard Variables</h4>
                                            <ul className="space-y-2 text-sm">
                                                <li className="flex items-center justify-between border-b border-slate-100 pb-1">
                                                    <code className="bg-slate-100 px-1.5 rounded text-blue-600 font-bold">Qty</code>
                                                    <span>The base measurement value</span>
                                                </li>
                                                <li className="flex items-center justify-between border-b border-slate-100 pb-1">
                                                    <code className="bg-slate-100 px-1.5 rounded text-blue-600 font-bold">Price</code>
                                                    <span>The unit price of the item</span>
                                                </li>
                                            </ul>
                                        </div>
                                        <div>
                                            <div>
                                                <h4 className="font-bold text-slate-700 mb-2">Math Functions</h4>
                                                <p className="text-sm text-slate-500 mb-2">Use these simplified functions in your formulas:</p>
                                                <ul className="space-y-2 text-sm">
                                                    <li className="border-b border-slate-100 pb-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">roundup(x)</code>
                                                            <span className="text-xs text-slate-400">or</span>
                                                            <code className="bg-slate-100 px-1.5 rounded text-slate-600 font-bold text-xs">Math.ceil(x)</code>
                                                        </div>
                                                        <span className="text-slate-600">Rounds up to the nearest whole number. Essential for materials like sheets or studs where you can't buy a fraction.</span>
                                                        <div className="text-xs text-slate-400 mt-0.5">Ex: roundup(4.2) = 5</div>
                                                    </li>
                                                    <li className="border-b border-slate-100 pb-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">round(x)</code>
                                                            <span className="text-xs text-slate-400">or</span>
                                                            <code className="bg-slate-100 px-1.5 rounded text-slate-600 font-bold text-xs">Math.round(x)</code>
                                                        </div>
                                                        <span className="text-slate-600">Rounds to the nearest whole number.</span>
                                                        <div className="text-xs text-slate-400 mt-0.5">Ex: round(4.6) = 5, round(4.4) = 4</div>
                                                    </li>
                                                    <li className="border-b border-slate-100 pb-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">floor(x)</code>
                                                            <span className="text-xs text-slate-400">or</span>
                                                            <code className="bg-slate-100 px-1.5 rounded text-slate-600 font-bold text-xs">Math.floor(x)</code>
                                                        </div>
                                                        <span className="text-slate-600">Rounds down to the nearest whole number.</span>
                                                        <div className="text-xs text-slate-400 mt-0.5">Ex: floor(4.9) = 4</div>
                                                    </li>
                                                    <li className="border-b border-slate-100 pb-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">max(x, y)</code>
                                                            <span className="text-xs text-slate-400">or</span>
                                                            <code className="bg-slate-100 px-1.5 rounded text-slate-600 font-bold text-xs">Math.max(x, y)</code>
                                                        </div>
                                                        <span className="text-slate-600">Returns the larger of two numbers. Great for setting minimums.</span>
                                                        <div className="text-xs text-slate-400 mt-0.5">Ex: max(Qty, 10) = At least 10</div>
                                                    </li>
                                                    <li className="pb-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">min(x, y)</code>
                                                            <span className="text-xs text-slate-400">•</span>
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">abs(x)</code>
                                                            <span className="text-xs text-slate-400">•</span>
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">sqrt(x)</code>
                                                            <span className="text-xs text-slate-400">•</span>
                                                            <code className="bg-green-100 px-1.5 rounded text-green-700 font-bold text-xs">pow(x,y)</code>
                                                        </div>
                                                        <span className="text-slate-600 text-xs">Additional functions: minimum, absolute value, square root, and power.</span>
                                                    </li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-xl font-bold text-slate-800">4. Example: Wall Assembly</h3>
                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
                                        <h4 className="font-bold text-slate-700">Scenario: 10ft High Interior Wall</h4>
                                    </div>
                                    <div className="p-6 space-y-6">

                                        <div>
                                            <h5 className="font-bold text-slate-800 mb-2 text-sm uppercase tracking-wider">Step 1: Define Variables</h5>
                                            <p className="text-sm text-slate-600 mb-2">In the <strong>General</strong> tab, add a custom variable for height.</p>
                                            <div className="flex items-center gap-4 text-sm bg-slate-50 p-3 rounded border border-slate-100">
                                                <span className="font-semibold">Wall Height</span>
                                                <span className="text-slate-400">→</span>
                                                <code className="bg-white px-2 py-1 rounded border">10</code>
                                            </div>
                                        </div>

                                        <div>
                                            <h5 className="font-bold text-slate-800 mb-2 text-sm uppercase tracking-wider">Step 2: Create Sub-Items</h5>
                                            <p className="text-sm text-slate-600 mb-3">In the <strong>Sub-Items</strong> tab, add the materials.</p>

                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between bg-white p-3 rounded border border-slate-200 shadow-sm">
                                                    <div>
                                                        <div className="font-bold text-slate-700">5/8" Drywall (4x10 Sheets)</div>
                                                        <div className="text-xs text-slate-500">Double sided</div>
                                                    </div>
                                                    <code className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono">
                                                        roundup((Qty * Wall_Height * 2) / 40)
                                                    </code>
                                                </div>

                                                <div className="flex items-center justify-between bg-white p-3 rounded border border-slate-200 shadow-sm">
                                                    <div>
                                                        <div className="font-bold text-slate-700">3-5/8" Metal Studs</div>
                                                        <div className="text-xs text-slate-500">16" OC + Top/Bottom Track</div>
                                                    </div>
                                                    <code className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono">
                                                        roundup(Qty * 0.75) + 2
                                                    </code>
                                                </div>

                                                <div className="flex items-center justify-between bg-white p-3 rounded border border-slate-200 shadow-sm">
                                                    <div>
                                                        <div className="font-bold text-slate-700">R-13 Insulation</div>
                                                        <div className="text-xs text-slate-500">Square Footage</div>
                                                    </div>
                                                    <code className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono">
                                                        Qty * Wall_Height
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            </section>

                        </div>
                    )}

                    {activeTab === 'shortcuts' && (
                        <div className="max-w-3xl mx-auto">
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 flex items-start gap-3">
                                <Keyboard className="text-blue-500 shrink-0 mt-0.5" size={20} />
                                <div className="text-sm text-blue-800">
                                    <p className="font-semibold mb-1">Pro Tip:</p>
                                    <p>These shortcuts are designed to match PlanSwift where possible for a familiar experience.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                                <div className="space-y-4">
                                    <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">Tools</h4>
                                    <div className="space-y-2">
                                        <ShortcutRow label="Area Tool" keys={['1']} />
                                        <ShortcutRow label="Linear Tool" keys={['2']} />
                                        <ShortcutRow label="Segment Tool" keys={['3']} />
                                        <ShortcutRow label="Count Tool" keys={['4']} />
                                        <ShortcutRow label="Note Tool" keys={['5']} />
                                        <ShortcutRow label="Select Tool" keys={['V']} />
                                        <ShortcutRow label="Scale Tool" keys={['S']} />
                                        <ShortcutRow label="Dimension Tool" keys={['D']} />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">Actions</h4>
                                    <div className="space-y-2">
                                        <ShortcutRow label="Undo" keys={['Cmd', 'Z']} />
                                        <ShortcutRow label="Redo" keys={['Cmd', 'Shift', 'Z']} />
                                        <ShortcutRow label="Save Project" keys={['Cmd', 'S']} />
                                        <ShortcutRow label="Copy Item" keys={['Cmd', 'C']} />
                                        <ShortcutRow label="Paste Item" keys={['Cmd', 'V']} />
                                        <ShortcutRow label="Delete Item" keys={['Backspace']} />
                                        <ShortcutRow label="Finish Shape" keys={['C']} />
                                        <ShortcutRow label="Cut Out (Deduction)" keys={['X']} />
                                        <ShortcutRow label="Toggle Record" keys={['R']} />
                                        <ShortcutRow label="Cancel / Deselect" keys={['Esc']} />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">Navigation & View</h4>
                                    <div className="space-y-2">
                                        <ShortcutRow label="Next Page" keys={['Page Down']} />
                                        <ShortcutRow label="Previous Page" keys={['Page Up']} />
                                        <ShortcutRow label="Zoom In" keys={['+']} />
                                        <ShortcutRow label="Zoom Out" keys={['-']} />
                                        <ShortcutRow label="Zoom to Fit" keys={['F7']} />
                                        <ShortcutRow label="Toggle View" keys={['F12']} />
                                    </div>
                                </div>

                            </div>
                        </div>
                    )}

                    {activeTab === 'license' && (
                        <div className="max-w-2xl mx-auto">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
                                {checkingLicense ? (
                                    <div className="flex flex-col items-center gap-3 py-6">
                                        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                                        <p className="text-slate-500 text-sm">Verifying license...</p>
                                    </div>
                                ) : licenseInfo ? (
                                    <div className="space-y-4">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className={`p-3 rounded-full ${licenseInfo.valid ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                                <ShieldCheck size={36} />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-slate-800">
                                                    {licenseInfo.valid ? 'License Active' : 'License Invalid'}
                                                </h3>
                                                <p className="text-slate-500 text-sm mt-0.5">{licenseInfo.message}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto text-left">
                                            {/* License Type */}
                                            <div className="col-span-2 bg-gradient-to-br from-purple-50 to-blue-50 p-3 rounded-lg border-2 border-purple-200">
                                                <div className="text-xs text-purple-600 uppercase tracking-wider font-bold mb-1 flex items-center gap-1">
                                                    {licenseInfo.licenseType === 'paid' ? <Crown size={11} /> : <ShieldCheck size={11} />}
                                                    License Type
                                                </div>
                                                <div className="font-bold text-base">
                                                    {licenseInfo.licenseType === 'paid' ? (
                                                        <span className="text-purple-700 flex items-center gap-1.5">
                                                            <Crown size={16} />
                                                            Paid License
                                                        </span>
                                                    ) : (
                                                        <span className="text-orange-600 flex items-center gap-1.5">
                                                            <ShieldCheck size={16} />
                                                            Trial License
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* License Key */}
                                            {licenseInfo.licenseKey && (
                                                <div className="col-span-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                                    <div className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1 flex items-center gap-1">
                                                        <Key size={11} />
                                                        License Key
                                                    </div>
                                                    <div className="font-mono text-xs text-slate-800 bg-white px-2 py-1.5 rounded border border-slate-200 break-all">
                                                        {licenseInfo.licenseKey}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Status */}
                                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                                <div className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Status</div>
                                                <div className={`font-semibold text-sm ${licenseInfo.valid ? 'text-green-600' : 'text-red-600'}`}>
                                                    {licenseInfo.valid ? 'Verified' : 'Unverified'}
                                                </div>
                                            </div>

                                            {/* Expiration Date */}
                                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                                <div className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Expiration</div>
                                                <div className="font-semibold text-sm text-slate-800">
                                                    {licenseInfo.expiresAt ? (
                                                        <div className="space-y-1">
                                                            <div>{new Date(licenseInfo.expiresAt).toLocaleDateString()}</div>
                                                            {(() => {
                                                                const exp = new Date(licenseInfo.expiresAt);
                                                                const now = new Date();
                                                                const diff = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                                                if (diff <= 7 && diff > 0) {
                                                                    return <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1 w-fit"><AlertTriangle size={10} /> {diff}d left</span>
                                                                }
                                                                if (diff <= 0) {
                                                                    return <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">Expired</span>
                                                                }
                                                                return null;
                                                            })()}
                                                        </div>
                                                    ) : (
                                                        <span className="text-green-600 flex items-center gap-1 text-sm">
                                                            <Crown size={13} />
                                                            Lifetime
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-slate-500 py-6 text-sm">
                                        Unable to load license information.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>,
        document.body
    );
};

const ShortcutRow: React.FC<{ label: string; keys: string[] }> = ({ label, keys }) => (
    <div className="flex items-center justify-between group">
        <span className="text-slate-600 text-sm font-medium group-hover:text-slate-900 transition-colors">{label}</span>
        <div className="flex items-center gap-1">
            {keys.map((k, i) => (
                <React.Fragment key={i}>
                    <kbd className="px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-mono text-slate-500 shadow-sm min-w-[24px] text-center font-bold">
                        {k}
                    </kbd>
                    {i < keys.length - 1 && <span className="text-slate-300 text-xs">+</span>}
                </React.Fragment>
            ))}
        </div>
    </div>
);

export default HelpModal;
