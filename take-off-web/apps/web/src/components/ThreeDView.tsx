import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { TakeoffItem, Shape, ToolType, PlanSet } from '../types';
import * as THREE from 'three';
import { mupdfController } from '../utils/mupdfController';

interface ThreeDViewProps {
  items: TakeoffItem[];
  onBack: () => void;
  planSets?: PlanSet[];
  pageIndex?: number;
}

const Shape3D: React.FC<{ shape: Shape; itemType: ToolType; color: string; depth: number }> = ({ shape, itemType, color, depth }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Centroid (used both for geometry recentering and mesh placement). Computed
  // once so geometry coords and mesh.position stay in sync.
  const centroid = React.useMemo(() => {
    if (shape.points.length === 0) return { x: 0, y: 0 };
    const sum = shape.points.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    return { x: sum.x / shape.points.length, y: sum.y / shape.points.length };
  }, [shape]);

  // Convert 2D shape to 3D geometry — recenter points around (0,0) before
  // building the THREE.Shape so the mesh's `position` (set to the centroid
  // below) doesn't double-translate the geometry. Previously the shape's
  // absolute PDF coordinates went into ExtrudeGeometry AND the mesh was
  // moved to those same coordinates, displacing solids one extra centroid
  // away from the plan texture.
  const geometry = React.useMemo(() => {
    if ((itemType === ToolType.AREA || itemType === ToolType.VOLUME) && shape.points.length >= 3) {
      const points = shape.points.map(p => new THREE.Vector2(p.x - centroid.x, p.y - centroid.y));
      const shape3D = new THREE.Shape(points);
      return new THREE.ExtrudeGeometry(shape3D, { depth: itemType === ToolType.VOLUME ? depth : 0.1, bevelEnabled: false });
    }
    return new THREE.BoxGeometry(10, 10, itemType === ToolType.VOLUME ? depth : 0.1); // Fallback
  }, [shape, itemType, depth, centroid]);

  const position = React.useMemo(
    () => [centroid.x, centroid.y, (itemType === ToolType.VOLUME ? depth : 0.1) / 2] as [number, number, number],
    [centroid, itemType, depth]
  );

  return (
    <mesh ref={meshRef} geometry={geometry} position={position}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const PDFPlane: React.FC<{ planSets?: PlanSet[]; pageIndex?: number }> = ({ planSets, pageIndex }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    const loadPDFTexture = async () => {
      if (!planSets || planSets.length === 0 || pageIndex === undefined) return;

      try {
        // Find the plan set for this page
        let planSet = null;
        let localPageIndex = pageIndex;
        
        for (const ps of planSets) {
          if (pageIndex >= ps.startPageIndex && pageIndex < ps.startPageIndex + ps.pageCount) {
            planSet = ps;
            localPageIndex = pageIndex - ps.startPageIndex;
            if (ps.pages && ps.pages[localPageIndex] !== undefined) {
              localPageIndex = ps.pages[localPageIndex];
            }
            break;
          }
        }

        if (!planSet) return;

        // Render PDF page to canvas
        const canvas = document.createElement('canvas');
        
        const arrayBuffer = await planSet.file.arrayBuffer();
        const pageCount = await mupdfController.loadDocument(new Uint8Array(arrayBuffer));
        
        // Render with appropriate scale
        await mupdfController.renderPageToCanvas(localPageIndex, canvas, 2.0);

        // Create texture from canvas
        const canvasTexture = new THREE.CanvasTexture(canvas);
        canvasTexture.flipY = false;
        setTexture(canvasTexture);
      } catch (error) {
        console.error('Failed to load PDF texture:', error);
      }
    };

    loadPDFTexture();
  }, [planSets, pageIndex]);

  return (
    // PDF plane sits in the same X/Y plane as the extruded shape geometry
    // (Shape3D builds its polygons from PDF X/Y and extrudes along Z).
    // Earlier this plane was rotated into X/Z, leaving the texture
    // perpendicular to every measurement solid. Now both share X/Y; the
    // plane sits just below z=0 so solids extruded into +Z appear on top.
    <mesh ref={meshRef} position={[2000, 2000, -0.05]}>
      <planeGeometry args={[4000, 4000]} />
      {texture ? (
        <meshStandardMaterial map={texture} />
      ) : (
        <meshStandardMaterial color="#ccc" />
      )}
    </mesh>
  );
};

const ThreeDView: React.FC<ThreeDViewProps> = ({ items, onBack, planSets, pageIndex }) => {
  return (
    <div className="h-full w-full bg-gray-900 relative">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 z-10 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        Back to Canvas
      </button>
      <Canvas camera={{ position: [0, 0, 100], fov: 75 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <OrbitControls 
          enablePan={true} 
          enableZoom={true} 
          enableRotate={true}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.DOLLY,
          }}
        />
        
        {/* PDF Background Plane */}
        <PDFPlane planSets={planSets} pageIndex={pageIndex} />
        
        {/* Only render shapes on the active page — otherwise multi-page
            projects would overlay page-1 measurements onto a page-2 plan. */}
        {items.map((item, itemIndex) => (
          item.shapes
            .filter(shape => pageIndex === undefined || shape.pageIndex === pageIndex)
            .map((shape, shapeIndex) => (
            <Shape3D
              key={`${itemIndex}-${shapeIndex}`}
              shape={shape}
              itemType={item.type}
              color={item.color}
              depth={item.depth || 1}
            />
          ))
        ))}
        
        {/* Ground plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -50, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#666" />
        </mesh>
      </Canvas>
    </div>
  );
};

export default ThreeDView;