
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
  const resizeDirection = useRef<'n' | 's' | 'e' | 'w' | 'se' | 'sw' | 'ne' | 'nw' | null>(null);
  
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

  const handleResizeDown = (e: React.MouseEvent, direction: 'n' | 's' | 'e' | 'w' | 'se' | 'sw' | 'ne' | 'nw') => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);
      resizeDirection.current = direction;
      dragStart.current = { x: e.clientX, y: e.clientY };
      initialLegendScale.current = scale;
      initialPos.current = { x, y };
      
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
        let dx = (e.clientX - dragStart.current.x) / current.zoomLevel;
        let dy = (e.clientY - dragStart.current.y) / current.zoomLevel;
        const dir = resizeDirection.current;

        if (dir?.includes('w')) dx = -dx;
        if (dir?.includes('n')) dy = -dy;

        const startWidth = initialSize.current.width * initialLegendScale.current;
        const startHeight = initialSize.current.height * initialLegendScale.current;

        // Use a small epsilon to prevent division by zero for very small legends
        const safeStartWidth = startWidth > 1 ? startWidth : 1;
        const safeStartHeight = startHeight > 1 ? startHeight : 1;

        // Calculate the percentage change requested for each dimension
        const changeX = (safeStartWidth + dx) / safeStartWidth;
        const changeY = (safeStartHeight + dy) / safeStartHeight;

        let scaleChangeFactor;
        
        // For cardinal directions, only the change in that direction is relevant
        if (dir === 'n' || dir === 's') {
            scaleChangeFactor = changeY;
        } else if (dir === 'e' || dir === 'w') {
            scaleChangeFactor = changeX;
        } else { // For corners, use the one that implies a larger scale to maintain aspect ratio
            scaleChangeFactor = Math.max(changeX, changeY);
        }

        const newScale = Math.max(0.2, initialLegendScale.current * scaleChangeFactor);
        
        const updates: Partial<LegendSettings> = { scale: newScale };
        const scaleChange = newScale - initialLegendScale.current;

        if (dir?.includes('w')) {
            updates.x = initialPos.current.x - (initialSize.current.width * scaleChange);
        }
        if (dir?.includes('n')) {
            updates.y = initialPos.current.y - (initialSize.current.height * scaleChange);
        }
        
        onUpdate(updates);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      resizeDirection.current = null;
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
        width: 350, // Reduced base width for better default size
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
                   <span className="font-medium text-slate-800" title={item.label}>{item.label.length > 50 ? `${item.label.substring(0, 50)}...` : item.label}</span>
                </div>
                <div className="font-mono font-bold text-slate-700 whitespace-nowrap">
                  {displayQty.toLocaleString(undefined, {maximumFractionDigits: 1})} {item.unit}
                </div>
             </div>
           );
        })}
      </div>
      
      {/* Resize Handles */}
      <div className="absolute -top-1 left-0 w-full h-2 cursor-ns-resize" onMouseDown={(e) => handleResizeDown(e, 'n')} />
      <div className="absolute -bottom-1 left-0 w-full h-2 cursor-ns-resize" onMouseDown={(e) => handleResizeDown(e, 's')} />
      <div className="absolute top-0 -left-1 h-full w-2 cursor-ew-resize" onMouseDown={(e) => handleResizeDown(e, 'w')} />
      <div className="absolute top-0 -right-1 h-full w-2 cursor-ew-resize" onMouseDown={(e) => handleResizeDown(e, 'e')} />

      <div className="absolute -top-1 -left-1 w-3 h-3 cursor-nwse-resize" onMouseDown={(e) => handleResizeDown(e, 'nw')} />
      <div className="absolute -top-1 -right-1 w-3 h-3 cursor-nesw-resize" onMouseDown={(e) => handleResizeDown(e, 'ne')} />
      <div className="absolute -bottom-1 -left-1 w-3 h-3 cursor-nesw-resize" onMouseDown={(e) => handleResizeDown(e, 'sw')} />
      <div className="absolute -bottom-1 -right-1 w-3 h-3 cursor-nwse-resize" onMouseDown={(e) => handleResizeDown(e, 'se')}>
          <div className="absolute bottom-0 right-0 p-1 text-slate-400 hover:text-slate-600 pointer-events-none">
              <Scaling size={12} />
          </div>
      </div>
    </div>
  );
};

export default DraggableLegend;
