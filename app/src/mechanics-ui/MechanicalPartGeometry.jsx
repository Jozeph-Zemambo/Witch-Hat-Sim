import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  COG_TOOTH_DEPTH,
  cogwheelToothCount,
} from '../../../src/mechanics-engine/index.js';

// The workshop and atelier must render the same serialized part vocabulary.
// Keeping one geometry implementation prevents a saved cogwheel or wedge from
// degrading into a generic cylinder/box after it leaves the workbench.
export function MechanicalPartGeometry({ part }) {
  const size = part.size;
  if (part.shape === 'sphere') return <sphereGeometry args={[Math.max(size.x, size.y, size.z) / 2, 22, 16]} />;
  if (part.shape === 'cylinder') return <cylinderGeometry args={[Math.max(size.x, size.z) / 2, Math.max(size.x, size.z) / 2, size.y, 24]} />;
  if (part.shape === 'wedge') return <MechanicalWedgeGeometry size={size} />;
  if (part.shape === 'cogwheel') return <MechanicalCogwheelGeometry size={size} />;
  return <boxGeometry args={[size.x, size.y, size.z]} />;
}

export function MechanicalCogwheelGeometry({ size }) {
  const geometry = useMemo(() => {
    const pitchRadius = Math.max(size.x, size.z) / 2;
    const rootRadius = Math.max(0.05, pitchRadius - COG_TOOTH_DEPTH / 2);
    const tipRadius = pitchRadius + COG_TOOTH_DEPTH / 2;
    const teeth = cogwheelToothCount(size);
    const step = (Math.PI * 2) / teeth;
    const profile = new THREE.Shape();
    for (let index = 0; index < teeth; index += 1) {
      const center = index * step;
      const points = [
        [center - step * 0.5, rootRadius],
        [center - step * 0.26, rootRadius],
        [center - step * 0.15, tipRadius],
        [center + step * 0.15, tipRadius],
        [center + step * 0.26, rootRadius],
      ];
      for (const [angle, radius] of points) {
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0 && angle === points[0][0]) profile.moveTo(x, y);
        else profile.lineTo(x, y);
      }
    }
    profile.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, Math.min(0.09, rootRadius * 0.35), 0, Math.PI * 2, true);
    profile.holes.push(hole);
    const value = new THREE.ExtrudeGeometry(profile, {
      depth: size.y,
      bevelEnabled: false,
      curveSegments: 12,
    });
    value.translate(0, 0, -size.y / 2);
    value.rotateX(Math.PI / 2);
    value.computeVertexNormals();
    return value;
  }, [size.x, size.y, size.z]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

export function MechanicalWedgeGeometry({ size }) {
  const geometry = useMemo(() => {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const value = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -hx, -hy, -hz, hx, -hy, -hz, -hx, hy, -hz,
      -hx, -hy, hz, hx, -hy, hz, -hx, hy, hz,
    ]);
    value.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    value.setIndex([
      0, 1, 2,
      3, 5, 4,
      0, 3, 4, 0, 4, 1,
      0, 2, 5, 0, 5, 3,
      1, 4, 5, 1, 5, 2,
      2, 1, 4, 2, 4, 5,
    ]);
    value.computeVertexNormals();
    return value;
  }, [size.x, size.y, size.z]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}
