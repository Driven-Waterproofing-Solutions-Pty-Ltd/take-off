
import React, { useState, useRef, useEffect } from 'react';
import { MousePointer2, Ruler, Spline, Scan, Hash, ZoomIn, ZoomOut, ChevronDown, Activity, Undo, Redo, ArrowLeftRight, MessageSquare, Type, VectorSquare, Waypoints, RulerDimensionLine, List } from 'lucide-react';
import { ToolType } from '../types';
import { PRESET_SCALES, PresetScale } from '../utils/geometry';

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
  const [showScaleMenu, setShowScaleMenu] = useState(false);
  const scaleMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (scaleMenuRef.current && !scaleMenuRef.current.contains(event.target as Node)) {
        setShowScaleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const btnClass = (isActive: boolean) =>
    `relative p-2 rounded-lg flex items-center justify-center transition-all duration-200 group ${isActive
      ? 'bg-slate-900 text-white shadow-md ring-1 ring-slate-900'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
    }`;

  const displayScale = Math.round(scale * 100);

  return (
    <div className="absolute top-6 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-3 z-50">

      {isRecording && (
        <div className="bg-red-500 text-white px-4 py-1.5 rounded-full text-xs font-semibold animate-in slide-in-from-top-2 fade-in shadow-lg flex items-center gap-2 ring-2 ring-white">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          Recording...
        </div>
      )}

      <div className="bg-white shadow-xl shadow-slate-200/50 border border-slate-200/60 rounded-2xl p-1.5 flex items-center gap-1.5 backdrop-blur-sm">
        {/* Undo/Redo Group */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-100 mr-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-2 rounded-lg transition-colors ${!canUndo ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
            title="Undo (Ctrl+Z)"
          >
            <Undo size={18} strokeWidth={2} />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-2 rounded-lg transition-colors ${!canRedo ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
            title="Redo (Ctrl+Y)"
          >
            <Redo size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setTool(ToolType.SELECT)}
            className={btnClass(activeTool === ToolType.SELECT)}
            title="Select (V)"
          >
            <MousePointer2 size={20} strokeWidth={2} />
          </button>

          <div className="w-px h-8 bg-slate-100 mx-1"></div>

          <div className="relative" ref={scaleMenuRef}>
            <button
              onClick={() => setShowScaleMenu(!showScaleMenu)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border transition-all ${(activeTool === ToolType.SCALE || isPageScaled) ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              title="Scale"
            >
              <Ruler size={18} strokeWidth={2} />
              <ChevronDown size={12} strokeWidth={3} className={`opacity-50 ${(activeTool === ToolType.SCALE || isPageScaled) ? 'text-white' : ''}`} />
            </button>

            {showScaleMenu && (
              <div className="absolute top-full mt-2 left-0 w-64 bg-white rounded-xl shadow-xl border border-slate-100 max-h-[400px] overflow-y-auto z-50 text-left p-1 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Manual Calibration</div>
                <button
                  onClick={() => { setTool(ToolType.SCALE); setShowScaleMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-blue-50 text-blue-600 font-medium flex items-center gap-2"
                >
                  <Ruler size={16} /> Calibrate Scale
                </button>

                {['Architectural', 'Engineering', 'Metric'].map(cat => (
                  <React.Fragment key={cat}>
                    <div className="px-3 py-2 mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-t border-slate-50">{cat}</div>
                    {PRESET_SCALES.filter(s => s.category === cat).map((s, i) => (
                      <button
                        key={i}
                        onClick={() => { onSetPresetScale(s); setShowScaleMenu(false); }}
                        className="w-full text-left px-3 py-1.5 text-sm rounded-md hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors"
                      >
                        {s.label}
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => onInitiateTool(ToolType.DIMENSION)}
            className={btnClass(activeTool === ToolType.DIMENSION)}
            title="Dimension (D)"
          >
            <RulerDimensionLine size={20} strokeWidth={2} />
          </button>

          <button
            onClick={() => onInitiateTool(ToolType.SEGMENT)}
            className={btnClass(activeTool === ToolType.SEGMENT)}
            title="Segment (3)"
          >
            <Spline size={20} strokeWidth={2} />
          </button>

          <button
            onClick={() => onInitiateTool(ToolType.LINEAR)}
            className={btnClass(activeTool === ToolType.LINEAR)}
            title="Linear (2)"
          >
            <Waypoints size={20} strokeWidth={2} />
          </button>

          <button
            onClick={() => onInitiateTool(ToolType.AREA)}
            className={btnClass(activeTool === ToolType.AREA)}
            title="Area (1)"
          >
            <VectorSquare size={20} strokeWidth={2} />
          </button>

          <button
            onClick={() => onInitiateTool(ToolType.COUNT)}
            className={btnClass(activeTool === ToolType.COUNT)}
            title="Count (4)"
          >
            <Hash size={20} strokeWidth={2} />
          </button>

          <button
            onClick={() => onInitiateTool(ToolType.NOTE)}
            className={btnClass(activeTool === ToolType.NOTE)}
            title="Note (5)"
          >
            <Type size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="w-px h-8 bg-slate-100 mx-1"></div>

        <div className="flex items-center gap-0.5 pl-1">
          {onToggleLegend && (
            <button
                onClick={onToggleLegend}
                className={btnClass(!!isLegendVisible)}
                title={isLegendVisible ? "Hide Legend" : "Show Legend"}
            >
                <List size={20} strokeWidth={2} />
            </button>
          )}
          <button
            onClick={() => setScale(Math.max(0.1, scale - 0.25))}
            className="p-2 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-900 transition-colors"
            title="Zoom Out (-)"
          >
            <ZoomOut size={18} strokeWidth={2} />
          </button>
          <span className="text-xs font-mono font-medium w-10 text-center text-slate-600">{displayScale}%</span>
          <button
            onClick={() => setScale(Math.min(10, scale + 0.25))}
            className="p-2 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-900 transition-colors"
            title="Zoom In (+)"
          >
            <ZoomIn size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div >
  );
};

export default Tools;
