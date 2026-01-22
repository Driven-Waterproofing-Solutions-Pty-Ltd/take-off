import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { TakeoffItem, Shape, ToolType } from '../types';
import * as THREE from 'three';

interface ThreeDViewProps {
  items: TakeoffItem[];
  onBack: () => void;
}

const Shape3D: React.FC<{ shape: Shape; itemType: ToolType; color: string; depth: number }> = ({ shape, itemType, color, depth }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Convert 2D shape to 3D geometry
  const geometry = React.useMemo(() => {
    if ((itemType === ToolType.AREA || itemType === ToolType.VOLUME) && shape.points.length >= 3) {
      const points = shape.points.map(p => new THREE.Vector2(p.x, p.y));
      const shape3D = new THREE.Shape(points);
      return new THREE.ExtrudeGeometry(shape3D, { depth: itemType === ToolType.VOLUME ? depth : 0.1, bevelEnabled: false });
    }
    return new THREE.BoxGeometry(10, 10, itemType === ToolType.VOLUME ? depth : 0.1); // Fallback
  }, [shape, itemType, depth]);

  // Calculate center position for the shape
  const position = React.useMemo(() => {
    if (shape.points.length > 0) {
      const center = shape.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      const avgX = center.x / shape.points.length;
      const avgY = center.y / shape.points.length;
      return [avgX, avgY, (itemType === ToolType.VOLUME ? depth : 0.1) / 2] as [number, number, number];
    }
    return [0, 0, (itemType === ToolType.VOLUME ? depth : 0.1) / 2] as [number, number, number];
  }, [shape, itemType, depth]);

  return (
    <mesh ref={meshRef} geometry={geometry} position={position}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const ThreeDView: React.FC<ThreeDViewProps> = ({ items, onBack }) => {
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
            RIGHT: THREE.MOUSE.ZOOM
          }}
        />
        
        {items.map((item, itemIndex) => (
          item.shapes.map((shape, shapeIndex) => (
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