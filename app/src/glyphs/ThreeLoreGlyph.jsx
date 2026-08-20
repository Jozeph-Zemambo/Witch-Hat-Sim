import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { resolveGlyphGeometry } from '../../../src/glyphs/lore-glyphs.js';
import { resolveNativeSignLayout } from '../../../src/glyphs/native-sign-layout.js';
import {
  GLYPH_PLANE_ROTATION_X,
  glyphSceneCenter,
  glyphSceneRotationY,
} from './threeGlyphTransform.js';

/** Three/R3F adapter over the same primitives used by glyphToSvg. */
export default function ThreeLoreGlyph({ symbol, color = '#173f31' }) {
  const signLayout = useMemo(() => symbol.nativeSignLayout ?? (symbol.categoryHint === 'sign'
    ? resolveNativeSignLayout({
        containingRingRadius: symbol.containingRingRadius ?? 100,
        signAnchor: symbol.signAnchor ?? anchorForPolarAngle(symbol.polarAngleDeg),
        facingDeg: symbol.facingDeg ?? symbol.angleDeg ?? 0,
        glyphId: symbol.registryId,
        size: symbol.size,
        centerClearance: symbol.centerClearance ?? 24,
        radialDistance: symbol.nativeLayoutMode === 'fixed' ? symbol.polarRadius : undefined,
        fitMode: symbol.nativeLayoutMode,
      })
    : null), [symbol.nativeSignLayout, symbol.categoryHint, symbol.containingRingRadius, symbol.signAnchor, symbol.polarAngleDeg, symbol.facingDeg, symbol.angleDeg, symbol.registryId, symbol.size, symbol.centerClearance, symbol.polarRadius, symbol.nativeLayoutMode]);
  const geometry = useMemo(
    () => resolveGlyphGeometry(symbol.registryId, {
      size: symbol.size,
      availableGap: signLayout?.availableGap ?? 1,
    }),
    [symbol.registryId, symbol.size, signLayout?.availableGap],
  );
  const texture = useMemo(
    () => (geometry ? makeGlyphTexture(geometry, color) : null),
    [color, geometry],
  );

  useEffect(() => () => texture?.dispose(), [texture]);
  if (!geometry || !texture) return null;

  const [minX, minY, maxX, maxY] = geometry.bounds;
  const pad = geometry.strokeWidth * 1.8;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const unitScale = geometry.category === 'sigil'
    ? 0.72 * Math.max(0.6, Math.min(1.5, Number(symbol.size ?? 400) / 400))
    : symbol.nativeUnitScale ?? 0.012;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const direction = symbol.renderDirection ?? symbol.inwardDirection ?? { x: 0, y: 1 };
  const rotationY = glyphSceneRotationY(
    geometry.category,
    direction,
    symbol.rotationDeg,
  );

  return (
    <group
      name={`lore-glyph:${symbol.registryId}:${symbol.objectId}`}
      rotation={[0, rotationY, 0]}
      userData={{
        glyphId: symbol.registryId,
        canonicalAxis: geometry.canonicalAxis,
        renderDirection: direction,
        size: symbol.size,
        nativeSignLayout: signLayout,
      }}
    >
      <mesh
        name={`glyph-surface:${symbol.registryId}:${symbol.objectId}`}
        position={glyphSceneCenter(centerX, centerY, unitScale)}
        rotation={[GLYPH_PLANE_ROTATION_X, 0, 0]}
      >
        <planeGeometry args={[width * unitScale, height * unitScale]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.08}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function anchorForPolarAngle(angleDeg = 0) {
  const radians = (Number(angleDeg) * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function makeGlyphTexture(geometry, color) {
  const [minX, minY, maxX, maxY] = geometry.bounds;
  const pad = geometry.strokeWidth * 1.8;
  const spanX = maxX - minX + pad * 2;
  const spanY = maxY - minY + pad * 2;
  const longest = Math.max(spanX, spanY);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(48, Math.ceil((spanX / longest) * 384));
  canvas.height = Math.max(48, Math.ceil((spanY / longest) * 384));
  const context = canvas.getContext('2d');
  if (!context) return null;

  const xScale = canvas.width / spanX;
  const yScale = canvas.height / spanY;
  const sx = (x) => (x - minX + pad) * xScale;
  const sy = (y) => (maxY - y + pad) * yScale;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = geometry.strokeWidth * Math.min(xScale, yScale);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const primitive of geometry.primitives) {
    context.beginPath();
    if (primitive.type === 'circle') {
      context.arc(sx(primitive.cx), sy(primitive.cy), primitive.r * Math.min(xScale, yScale), 0, Math.PI * 2);
      if (primitive.fill) context.fill();
      else context.stroke();
      continue;
    }
    for (const command of primitive.commands) {
      if (command.op === 'M') context.moveTo(sx(command.x), sy(command.y));
      else if (command.op === 'L') context.lineTo(sx(command.x), sy(command.y));
      else if (command.op === 'C') context.bezierCurveTo(sx(command.x1), sy(command.y1), sx(command.x2), sy(command.y2), sx(command.x), sy(command.y));
      else if (command.op === 'Q') context.quadraticCurveTo(sx(command.x1), sy(command.y1), sx(command.x), sy(command.y));
      else if (command.op === 'Z') context.closePath();
    }
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
