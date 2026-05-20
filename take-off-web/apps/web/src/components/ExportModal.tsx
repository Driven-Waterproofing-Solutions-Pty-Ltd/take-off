import React, { useState } from 'react';
import { PlanSet, ProjectData } from '../types';
import { FileDown, Loader2, Check } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

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

    const togglePage = (idx: number) => {
        const newSet = new Set(selectedPages);
        if (newSet.has(idx)) {
            newSet.delete(idx);
        } else {
            newSet.add(idx);
        }
        setSelectedPages(newSet);
    };

    const calculateProgressValue = () => {
        if (!progress || progress.total === 0) return 0;
        return (progress.current / progress.total) * 100;
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isExporting && !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileDown className="w-5 h-5" /> Export Markup PDF
                    </DialogTitle>
                    <DialogDescription>
                        Generate a PDF with your measurements burned in.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {isExporting ? (
                        <div className="flex flex-col items-center justify-center py-8 space-y-6">
                            <div className="relative">
                                <Loader2 size={48} className="text-primary animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-bold">{progress ? Math.round(calculateProgressValue()) : 0}%</span>
                                </div>
                            </div>
                            <div className="text-center w-full space-y-2">
                                <h3 className="font-semibold text-lg">Generating PDF...</h3>
                                {progress && (
                                    <>
                                        <Progress value={calculateProgressValue()} className="w-full h-2" />
                                        <p className="text-sm text-muted-foreground">
                                            Processing page {progress.current} of {progress.total}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Scope Selection */}
                            <div className="space-y-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Export Scope</Label>
                                <ToggleGroup
                                    type="single"
                                    value={mode}
                                    onValueChange={(val) => val && setMode(val as any)}
                                    variant="outline"
                                    className="justify-start w-full"
                                >
                                    <ToggleGroupItem
                                        value="current"
                                        className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                    >
                                        Current Page
                                    </ToggleGroupItem>
                                    <ToggleGroupItem
                                        value="all"
                                        className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                    >
                                        All Pages
                                    </ToggleGroupItem>
                                    <ToggleGroupItem
                                        value="custom"
                                        className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                    >
                                        Select Pages
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            </div>

                            {/* Custom Selection List */}
                            {mode === 'custom' && (
                                <ScrollArea className="h-48 border rounded-md p-2 bg-muted/20">
                                    {planSets.map(plan => (
                                        <div key={plan.id} className="mb-4 last:mb-0">
                                            <div className="text-xs font-bold text-muted-foreground mb-2 px-2 uppercase">{plan.name}</div>
                                            <div className="space-y-1">
                                                {Array.from({ length: plan.pageCount }).map((_, i) => {
                                                    const globalIdx = plan.startPageIndex + i;
                                                    const pageName = projectData[globalIdx]?.name || `Page ${i + 1}`;
                                                    const isSelected = selectedPages.has(globalIdx);
                                                    return (
                                                        <div
                                                            key={globalIdx}
                                                            className={cn(
                                                                "flex items-center space-x-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors min-w-0",
                                                                isSelected ? "bg-primary/10" : "hover:bg-muted"
                                                            )}
                                                            onClick={() => togglePage(globalIdx)}
                                                        >
                                                            <Checkbox
                                                                id={`page-${globalIdx}`}
                                                                checked={isSelected}
                                                                onCheckedChange={() => togglePage(globalIdx)}
                                                            />
                                                            <label
                                                                htmlFor={`page-${globalIdx}`}
                                                                className="text-sm cursor-pointer flex-1 select-none truncate"
                                                                onClick={(e) => e.preventDefault()} // Prevent double toggle due to label
                                                                title={pageName}
                                                            >
                                                                {pageName}
                                                            </label>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </ScrollArea>
                            )}

                            <Separator />

                            {/* Options */}
                            <div className="space-y-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Options</Label>
                                <div className="grid gap-3">
                                    <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-muted/50 transition-colors">
                                        <Checkbox
                                            id="includeLegend"
                                            checked={includeLegend}
                                            onCheckedChange={(checked) => setIncludeLegend(checked as boolean)}
                                        />
                                        <div className="space-y-1 leading-none">
                                            <Label htmlFor="includeLegend" className="cursor-pointer">
                                                Include Item Legend
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Adds a table with quantities to each page
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-muted/50 transition-colors">
                                        <Checkbox
                                            id="includeNotes"
                                            checked={includeNotes}
                                            onCheckedChange={(checked) => setIncludeNotes(checked as boolean)}
                                        />
                                        <div className="space-y-1 leading-none">
                                            <Label htmlFor="includeNotes" className="cursor-pointer">
                                                Include Notes
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Adds text annotations to the PDF
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isExporting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting || (mode === 'custom' && selectedPages.size === 0)}
                        className="min-w-[120px]"
                    >
                        {isExporting ? 'Generating...' : 'Export PDF'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ExportModal;