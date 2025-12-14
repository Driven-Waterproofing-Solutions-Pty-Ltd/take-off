import React, { useState, useEffect } from 'react';
import { X, Keyboard, BookOpen, MousePointer2, Layers, FileDown, Save, Calculator, Settings, Crown, ExternalLink, VectorSquare, Waypoints, Spline, Hash, RulerDimensionLine } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'guide' | 'shortcuts' | 'properties';
}

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, initialTab }) => {
    const [activeTab, setActiveTab] = useState<'guide' | 'shortcuts' | 'properties'>('guide');

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab);
        }
    }, [initialTab, isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[800px] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-white dark:bg-slate-950">
                <DialogHeader className="px-6 py-4 border-b bg-muted/20 flex flex-row items-center justify-between space-y-0">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg">
                            <BookOpen size={24} />
                        </div>
                        <div>
                            <DialogTitle className="text-xl">ProTakeoff Guide</DialogTitle>
                            <DialogDescription>Documentation, Properties & Shortcuts</DialogDescription>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 mr-4">
                        <img src="/protakeoff.png" alt="ProTakeoff" className="h-8 object-contain" />
                        <a href="mailto:info@protakeoff.org" className="text-[10px] text-muted-foreground hover:text-primary transition-colors">
                            info@protakeoff.org
                        </a>
                    </div>
                    {/* Close button is automatically added by DialogContent, but we can have extra header content here if needed */}
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
                    <div className="border-b px-6 py-2 bg-muted/20">
                        <TabsList className="grid w-full grid-cols-3 max-w-xl">
                            <TabsTrigger value="guide" className="gap-2">
                                <BookOpen size={14} /> User Manual
                            </TabsTrigger>
                            <TabsTrigger value="properties" className="gap-2">
                                <Calculator size={14} /> Properties & Formulas
                            </TabsTrigger>
                            <TabsTrigger value="shortcuts" className="gap-2">
                                <Keyboard size={14} /> Keyboard Shortcuts
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="flex-1 overflow-y-auto bg-muted/10">
                        <div className="p-8 max-w-4xl mx-auto">
                            <TabsContent value="guide" className="space-y-8 mt-0">
                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <Layers className="text-primary" size={24} /> Getting Started
                                    </h3>
                                    <Card>
                                        <CardContent className="pt-6 space-y-4 leading-relaxed">
                                            <p>
                                                <strong>1. Create or Load a Project:</strong> Start by creating a new project or loading an existing `.takeoff` file using the folder icons in the sidebar.
                                            </p>
                                            <p>
                                                <strong>2. Upload Plans:</strong> Click the <Badge variant="outline" className="px-1.5 py-0 mx-1 bg-muted">+</Badge> icon in the sidebar to upload PDF plan sets. You can upload multiple files at once.
                                            </p>
                                            <div>
                                                <strong>3. Set Scale:</strong> Before measuring, you must set the scale for each page. Select the <strong>Scale Tool (S)</strong> and either:
                                                <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
                                                    <li>Choose a preset scale (e.g., 1/4" = 1') from the dropdown.</li>
                                                    <li>Calibrate manually by measuring a known dimension on the plan.</li>
                                                </ul>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </section>

                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <MousePointer2 className="text-secondary-foreground" size={24} /> Measurement Tools
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Card className="hover:border-primary/50 transition-colors">
                                            <CardHeader>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <VectorSquare size={16} /> Area (1)
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="text-sm text-muted-foreground">
                                                Measure square footage. Click points to define a polygon. Press <strong>C</strong> to close and finish.
                                            </CardContent>
                                        </Card>
                                        <Card className="hover:border-primary/50 transition-colors">
                                            <CardHeader>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <Waypoints size={16} /> Linear (2)
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="text-sm text-muted-foreground">
                                                Measure continuous lines (walls, curbing). Click points to trace. Double-click or press <strong>C</strong> to finish.
                                            </CardContent>
                                        </Card>
                                        <Card className="hover:border-primary/50 transition-colors">
                                            <CardHeader>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <Spline size={16} /> Segment (3)
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="text-sm text-muted-foreground">
                                                Measure individual line segments (beams, headers). Click start and end points for each segment.
                                            </CardContent>
                                        </Card>
                                        <Card className="hover:border-primary/50 transition-colors">
                                            <CardHeader>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <Hash size={16} /> Count (4)
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="text-sm text-muted-foreground">
                                                Count individual items (fixtures, outlets). Click to place a marker.
                                            </CardContent>
                                        </Card>
                                        <Card className="hover:border-primary/50 transition-colors">
                                            <CardHeader>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <RulerDimensionLine size={16} /> Dimension (D)
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="text-sm text-muted-foreground">
                                                Measure specific distances/dimensions between two points without recording an item to the list.
                                            </CardContent>
                                        </Card>
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <Settings className="text-muted-foreground" size={24} /> Advanced Features
                                    </h3>
                                    <Card>
                                        <CardContent className="pt-6 space-y-6">
                                            <div className="flex gap-4">
                                                <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0 h-fit"><FileDown size={20} /></div>
                                                <div>
                                                    <h4 className="font-bold mb-1">Exporting</h4>
                                                    <p className="text-sm text-muted-foreground mb-2">Click the <strong>Export</strong> button in the sidebar to generate a PDF.</p>
                                                    <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
                                                        <li><strong>Burn-in Markups:</strong> Your measurements will be visually drawn onto the PDF pages.</li>
                                                        <li><strong>Scale:</strong> The PDF retains the original quality and scale.</li>
                                                        <li><strong>Legend:</strong> A legend of items can be optionally added (future feature).</li>
                                                    </ul>
                                                </div>
                                            </div>
                                            <Separator />
                                            <div className="flex gap-4">
                                                <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0 h-fit"><Save size={20} /></div>
                                                <div>
                                                    <h4 className="font-bold mb-1">Item Templates</h4>
                                                    <p className="text-sm text-muted-foreground mb-2">Save frequently used items (like specific wall assemblies) as templates.</p>
                                                    <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
                                                        <li><strong>Save:</strong> In the Item Properties modal, click "Save as Template".</li>
                                                        <li><strong>Reuse:</strong> When creating a new item, you can select from your saved templates (coming soon to the New Item modal).</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </section>
                            </TabsContent>

                            <TabsContent value="properties" className="space-y-8 mt-0">
                                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
                                    <Calculator className="text-primary shrink-0 mt-0.5" size={20} />
                                    <div className="text-sm text-foreground">
                                        <p className="font-semibold mb-1">Power User Feature</p>
                                        <p>Use Properties and Sub-Items to build complex assemblies. Define variables and formulas to automatically calculate materials based on your measurements.</p>
                                    </div>
                                </div>

                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold">1. Item Properties</h3>
                                    <Card>
                                        <CardContent className="pt-6 space-y-4">
                                            <p>Right-click any item in the sidebar and select <strong>Properties</strong> to open the editor.</p>
                                            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                                                <li><strong>Name & Group:</strong> Organize your items.</li>
                                                <li><strong>Color:</strong> Change the visual appearance on the canvas.</li>
                                                <li><strong>Custom Variables:</strong> Add your own variables (e.g., "Wall Height", "Depth", "Waste %") to use in formulas.</li>
                                            </ul>
                                        </CardContent>
                                    </Card>
                                </section>

                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold">2. Sub-Items (Parts)</h3>
                                    <Card>
                                        <CardContent className="pt-6 space-y-4">
                                            <p>Sub-items allow you to break down a measurement into material lists. For example, a "Wall" linear measurement can generate sub-items for Studs, Drywall, and Insulation.</p>
                                            <div className="bg-muted p-4 rounded-lg border border-border">
                                                <h4 className="font-bold mb-2">How to add Sub-Items:</h4>
                                                <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
                                                    <li>Open Item Properties.</li>
                                                    <li>Switch to the <strong>Sub-Items</strong> tab.</li>
                                                    <li>Enter a Name (e.g., "2x4 Studs").</li>
                                                    <li>Enter a Formula (e.g., `Qty / 1.33`).</li>
                                                    <li>Click <strong>Add</strong>.</li>
                                                </ol>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </section>

                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold">3. Formulas & Variables</h3>
                                    <Card>
                                        <CardContent className="pt-6 space-y-4">
                                            <p>Formulas allow dynamic calculations. You can use standard math (`+`, `-`, `*`, `/`, `()`) and variables.</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <h4 className="font-bold mb-2">Standard Variables</h4>
                                                    <ul className="space-y-2 text-sm">
                                                        <li className="flex items-center justify-between border-b pb-1">
                                                            <Badge variant="secondary" className="font-mono text-primary">Qty</Badge>
                                                            <span className="text-muted-foreground">The base measurement value</span>
                                                        </li>
                                                        <li className="flex items-center justify-between border-b pb-1">
                                                            <Badge variant="secondary" className="font-mono text-primary">Price</Badge>
                                                            <span className="text-muted-foreground">The unit price of the item</span>
                                                        </li>
                                                    </ul>
                                                </div>
                                                <div>
                                                    <h4 className="font-bold mb-2">Math Functions</h4>
                                                    <p className="text-sm text-muted-foreground mb-2">Use these simplified functions in your formulas:</p>
                                                    <div className="space-y-3">
                                                        <div className="border-b pb-2">
                                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-bold text-primary">roundup(x)</code>
                                                                <span className="text-xs text-muted-foreground">or</span>
                                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-bold">Math.ceil(x)</code>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">Rounds up to nearest whole #. (Ex: roundup(4.2) = 5)</p>
                                                        </div>
                                                        <div className="border-b pb-2">
                                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-bold text-primary">round(x)</code>
                                                                <span className="text-xs text-muted-foreground">or</span>
                                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-bold">Math.round(x)</code>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">Rounds to nearest whole #. (Ex: round(4.6) = 5)</p>
                                                        </div>
                                                        <div className="pb-1">
                                                            <div className="flex flex-wrap items-center gap-2 mb-1 text-xs">
                                                                <code className="bg-muted px-1.5 py-0.5 rounded font-bold text-primary">floor(x)</code>
                                                                <code className="bg-muted px-1.5 py-0.5 rounded font-bold text-primary">max(x,y)</code>
                                                                <code className="bg-muted px-1.5 py-0.5 rounded font-bold text-primary">min(x,y)</code>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </section>

                                <section className="space-y-4">
                                    <h3 className="text-xl font-bold">4. Example: Wall Assembly</h3>
                                    <div className="border rounded-xl overflow-hidden shadow-sm">
                                        <div className="bg-muted px-6 py-3 border-b">
                                            <h4 className="font-bold">Scenario: 10ft High Interior Wall</h4>
                                        </div>
                                        <div className="p-6 space-y-6 bg-card">
                                            <div>
                                                <h5 className="font-bold mb-2 text-sm uppercase tracking-wider text-muted-foreground">Step 1: Define Variables</h5>
                                                <p className="text-sm text-muted-foreground mb-2">In the <strong>General</strong> tab, add a custom variable for height.</p>
                                                <div className="flex items-center gap-4 text-sm bg-muted/50 p-3 rounded border">
                                                    <span className="font-semibold">Wall Height</span>
                                                    <span className="text-muted-foreground">→</span>
                                                    <code className="bg-background px-2 py-1 rounded border shadow-sm">10</code>
                                                </div>
                                            </div>

                                            <div>
                                                <h5 className="font-bold mb-2 text-sm uppercase tracking-wider text-muted-foreground">Step 2: Create Sub-Items</h5>
                                                <p className="text-sm text-muted-foreground mb-3">In the <strong>Sub-Items</strong> tab, add the materials.</p>

                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between bg-muted/30 p-3 rounded border">
                                                        <div>
                                                            <div className="font-bold text-sm">5/8" Drywall (4x10 Sheets)</div>
                                                            <div className="text-xs text-muted-foreground">Double sided</div>
                                                        </div>
                                                        <code className="text-xs bg-background text-primary px-2 py-1 rounded font-mono border border-border">
                                                            roundup((Qty * Wall_Height * 2) / 40)
                                                        </code>
                                                    </div>

                                                    <div className="flex items-center justify-between bg-muted/30 p-3 rounded border">
                                                        <div>
                                                            <div className="font-bold text-sm">3-5/8" Metal Studs</div>
                                                            <div className="text-xs text-muted-foreground">16" OC + Top/Bottom Track</div>
                                                        </div>
                                                        <code className="text-xs bg-background text-primary px-2 py-1 rounded font-mono border border-border">
                                                            roundup(Qty * 0.75) + 2
                                                        </code>
                                                    </div>

                                                    <div className="flex items-center justify-between bg-muted/30 p-3 rounded border">
                                                        <div>
                                                            <div className="font-bold text-sm">R-13 Insulation</div>
                                                            <div className="text-xs text-muted-foreground">Square Footage</div>
                                                        </div>
                                                        <code className="text-xs bg-background text-primary px-2 py-1 rounded font-mono border border-border">
                                                            Qty * Wall_Height
                                                        </code>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </TabsContent>

                            <TabsContent value="shortcuts" className="mt-0">
                                <div className="space-y-6">
                                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
                                        <Keyboard className="text-primary shrink-0 mt-0.5" size={20} />
                                        <div className="text-sm text-foreground">
                                            <p className="font-semibold mb-1">Pro Tip:</p>
                                            <p>These shortcuts are designed to match PlanSwift where possible for a familiar experience.</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-4">
                                            <h4 className="font-bold border-b pb-2">Tools</h4>
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
                                            <h4 className="font-bold border-b pb-2">Actions</h4>
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
                                            <h4 className="font-bold border-b pb-2">Navigation & View</h4>
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
                            </TabsContent>
                        </div>
                    </div>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

const ShortcutRow: React.FC<{ label: string; keys: string[] }> = ({ label, keys }) => (
    <div className="flex items-center justify-between group py-1">
        <span className="text-muted-foreground text-sm font-medium group-hover:text-foreground transition-colors">{label}</span>
        <div className="flex items-center gap-1">
            {keys.map((k, i) => (
                <React.Fragment key={i}>
                    <kbd className="px-2 py-1 bg-muted border border-border rounded-md text-xs font-mono text-muted-foreground shadow-sm min-w-[24px] text-center font-bold">
                        {k}
                    </kbd>
                    {i < keys.length - 1 && <span className="text-muted-foreground/30 text-xs">+</span>}
                </React.Fragment>
            ))}
        </div>
    </div>
);

export default HelpModal;
