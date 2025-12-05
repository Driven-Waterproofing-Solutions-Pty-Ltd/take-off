
import React, { useState, useEffect, useRef } from 'react';
import { TakeoffItem, ToolType, LegendSettings } from '../types';
import { GripHorizontal, Scaling, X } from 'lucide-react';
import { evaluateFormula } from '../utils/math';

interface DraggableLegendProps {
  items: TakeoffItem[];
  globalPageIndex: number;
  zoomLevel: number; // Current canvas zoom (for drag calculations)
  visible: boolean;
  
  // Controlled State
  x: number;
  y: number;
  scale: number; // Legend specific scale (sizing)
  onUpdate: (updates: Partial<LegendSettings>) => void;
}

const DraggableLegend: React.FC<DraggableLegendProps> = ({ 
    items, 
    globalPageIndex, 
    zoomLevel, 
    visible,
    x,
    y,
    scale,
    onUpdate
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  
  const dragStart = useRef({ x: 0, y: 0 });
  const initialPos = useRef({ x: 0, y: 0 });
  const initialLegendScale = useRef(1);
  const initialSize = useRef({ width: 0, height: 0 });
  
  // Ref to hold latest props to avoid stale closures in event listeners
  const stateRef = useRef({ x, y, scale, zoomLevel });
  stateRef.current = { x, y, scale, zoomLevel };
  
  const containerRef = useRef<HTMLDivElement>(null);

  const pageItems = items.filter(item =>
    item.visible !== false &&
    item.type !== ToolType.NOTE &&
    item.shapes.some(s => s.pageIndex === globalPageIndex)
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    initialPos.current = { x, y };
  };

  const handleResizeDown = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      initialLegendScale.current = scale;
      
      if (containerRef.current) {
          initialSize.current = {
              width: containerRef.current.offsetWidth,
              height: containerRef.current.offsetHeight
          };
      }
  };

  const handleClose = (e: React.MouseEvent) => {
      e.stopPropagation();
      onUpdate({ visible: false });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const current = stateRef.current;
      
      if (isDragging) {
          // Adjust drag delta by zoomLevel so the element moves 1:1 with mouse cursor visually
          const dx = (e.clientX - dragStart.current.x) / current.zoomLevel;
          const dy = (e.clientY - dragStart.current.y) / current.zoomLevel;
          
          onUpdate({
            x: initialPos.current.x + dx,
            y: initialPos.current.y + dy
          });
      }
      
      if (isResizing) {
          const dx = (e.clientX - dragStart.current.x) / current.zoomLevel;
          const dy = (e.clientY - dragStart.current.y) / current.zoomLevel;

          const startWidth = initialSize.current.width * initialLegendScale.current;
          const startHeight = initialSize.current.height * initialLegendScale.current;

          const newWidth = Math.max(50, startWidth + dx);
          const newHeight = Math.max(50, startHeight + dy);
          
          const scaleX = newWidth / initialSize.current.width;
          const scaleY = newHeight / initialSize.current.height;

          // Uniform scaling based on max dimension change
          const newScale = Math.max(0.2, Math.max(scaleX, scaleY));
          
          onUpdate({ scale: newScale });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, onUpdate]);

  if (!visible || pageItems.length === 0) return null;

  return (
    <div 
      ref={containerRef}
      className="absolute z-30 bg-white/95 border border-slate-900 shadow-xl rounded-sm flex flex-col origin-top-left"
      style={{ 
        left: x,
        top: y,
        width: 220, // Reduced base width for better default size
        transform: `scale(${scale})`
      }}
      onMouseDown={(e) => e.stopPropagation()} 
    >
      <div 
        className="bg-slate-800 text-white p-1 cursor-move flex justify-between items-center shrink-0 h-6 select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="w-4"></div>
        <GripHorizontal size={14} />
        <div 
            className="w-4 h-4 flex items-center justify-center cursor-pointer hover:text-red-300"
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag start on close
        >
            <X size={12} />
        </div>
      </div>
      
      <div className="p-2 space-y-1 flex-1 overflow-hidden select-none">
        <h4 className="font-bold text-slate-900 border-b border-slate-300 pb-1 mb-1 text-center uppercase tracking-wider text-[10px]">Legend</h4>
        {pageItems.map(item => {
           const pageShapes = item.shapes.filter(s => s.pageIndex === globalPageIndex);
           const pageRawQty = pageShapes.reduce((sum, s) => {
               if (s.deduction) return sum - s.value;
               return sum + s.value;
           }, 0);
           const displayQty = evaluateFormula(item, pageRawQty);
           
           return (
             <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex-1 flex items-center gap-2 overflow-hidden">
                   <div className="w-3 h-3 border border-slate-400 shrink-0" style={{ backgroundColor: item.color }}></div>
                   <span className="font-medium text-slate-800 truncate">{item.label}</span>
                </div>
                <div className="font-mono font-bold text-slate-700 whitespace-nowrap">
                  {displayQty.toLocaleString(undefined, {maximumFractionDigits: 1})} {item.unit}
                </div>
             </div>
           );
        })}
      </div>
      
      {/* Resize Handle */}
      <div 
        className="absolute bottom-0 right-0 p-1 cursor-nwse-resize text-slate-400 hover:text-slate-600"
        onMouseDown={handleResizeDown}
      >
          <Scaling size={12} />
      </div>
    </div>
  );
};

export default DraggableLegend;
