
import React, { useState, useRef, useEffect } from 'react';
import { MousePointer2, Ruler, Spline, Scan, Hash, ZoomIn, ZoomOut, ChevronDown, Activity, Undo, Redo, ArrowLeftRight, MessageSquare, Type, VectorSquare, Waypoints, RulerDimensionLine, List } from 'lucide-react';
import { ToolType } from '../types';
import { PRESET_SCALES, PresetScale } from '../utils/geometry';
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils";

interface ToolsProps {
  activeTool: ToolType;
  setTool: (t: ToolType) => void;
  onInitiateTool: (t: ToolType) => void;
  scale: number;
  setScale: (s: number) => void;
  onSetPresetScale: (preset: PresetScale) => void;
  isRecording: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isLegendVisible?: boolean;
  onToggleLegend?: () => void;
  isPageScaled: boolean;
}

const Tools: React.FC<ToolsProps> = ({
  activeTool,
  setTool,
  onInitiateTool,
  scale,
  setScale,
  onSetPresetScale,
  isRecording,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isLegendVisible,
  onToggleLegend,
  isPageScaled
}) => {
  const displayScale = Math.round(scale * 100);

  return (
    <div className="absolute top-6 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-3 z-50">

      {isRecording && (
        <div className="bg-destructive text-destructive-foreground px-4 py-1.5 rounded-full text-xs font-semibold animate-in slide-in-from-top-2 fade-in shadow-lg flex items-center gap-2 ring-2 ring-background">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          Recording...
        </div>
      )}

      <div className="bg-background/80 backdrop-blur-md shadow-xl shadow-black/5 border border-border rounded-xl p-1.5 flex items-center gap-1.5">

        <TooltipProvider delayDuration={300}>
          {/* Undo/Redo Group */}
          <div className="flex items-center gap-0.5 pr-2 mr-1 relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="h-9 w-9"
                >
                  <Undo size={18} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRedo}
                  disabled={!canRedo}
                  className="h-9 w-9"
                >
                  <Redo size={18} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6 absolute right-0 top-1.5" />
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.SELECT ? "default" : "ghost"}
                  size="icon"
                  onClick={() => setTool(ToolType.SELECT)}
                  className="h-9 w-9"
                >
                  <MousePointer2 size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Select (V)</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={(activeTool === ToolType.SCALE || isPageScaled) ? "default" : "ghost"}
                      className={cn("h-9 gap-1 px-3", !(activeTool === ToolType.SCALE || isPageScaled) && "border-dashed border border-border")}
                    >
                      <Ruler size={18} strokeWidth={2} />
                      <ChevronDown size={12} strokeWidth={3} className="opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Scale</TooltipContent>
              </Tooltip>

              <DropdownMenuContent align="start" className="w-56 max-h-[400px] overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">Manual Calibration</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setTool(ToolType.SCALE)}>
                  <Ruler size={16} className="mr-2" /> Calibrate Scale
                </DropdownMenuItem>

                {['Architectural', 'Engineering', 'Metric'].map(cat => (
                  <React.Fragment key={cat}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">{cat}</DropdownMenuLabel>
                    {PRESET_SCALES.filter(s => s.category === cat).map((s, i) => (
                      <DropdownMenuItem key={i} onClick={() => onSetPresetScale(s)}>
                        {s.label}
                      </DropdownMenuItem>
                    ))}
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.DIMENSION ? "default" : "ghost"}
                  size="icon"
                  onClick={() => onInitiateTool(ToolType.DIMENSION)}
                  className="h-9 w-9"
                >
                  <RulerDimensionLine size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dimension (D)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.SEGMENT ? "default" : "ghost"}
                  size="icon"
                  onClick={() => onInitiateTool(ToolType.SEGMENT)}
                  className="h-9 w-9"
                >
                  <Spline size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Segment (3)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.LINEAR ? "default" : "ghost"}
                  size="icon"
                  onClick={() => onInitiateTool(ToolType.LINEAR)}
                  className="h-9 w-9"
                >
                  <Waypoints size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Linear (2)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.AREA ? "default" : "ghost"}
                  size="icon"
                  onClick={() => onInitiateTool(ToolType.AREA)}
                  className="h-9 w-9"
                >
                  <VectorSquare size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Area (1)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.COUNT ? "default" : "ghost"}
                  size="icon"
                  onClick={() => onInitiateTool(ToolType.COUNT)}
                  className="h-9 w-9"
                >
                  <Hash size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Count (4)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === ToolType.NOTE ? "default" : "ghost"}
                  size="icon"
                  onClick={() => onInitiateTool(ToolType.NOTE)}
                  className="h-9 w-9"
                >
                  <Type size={20} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Note (5)</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <div className="flex items-center gap-0.5 pl-1">
            {onToggleLegend && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isLegendVisible ? "secondary" : "ghost"}
                    size="icon"
                    onClick={onToggleLegend}
                    className="h-9 w-9"
                  >
                    <List size={20} strokeWidth={2} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isLegendVisible ? "Hide Legend" : "Show Legend"}</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setScale(Math.max(0.1, scale - 0.25))}
                  className="h-9 w-9 text-muted-foreground"
                >
                  <ZoomOut size={18} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom Out (-)</TooltipContent>
            </Tooltip>

            <span className="text-xs font-mono font-medium w-10 text-center text-muted-foreground select-none">{displayScale}%</span>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setScale(Math.min(10, scale + 0.25))}
                  className="h-9 w-9 text-muted-foreground"
                >
                  <ZoomIn size={18} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom In (+)</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div >
  );
};

export default Tools;
