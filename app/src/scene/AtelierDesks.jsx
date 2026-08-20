import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ATELIER_DESK_LAYOUT } from '../world-physics/force-contract.js';
import { resolveGlyphGeometry } from '../../../src/glyphs/lore-glyphs.js';

const COLORS = Object.freeze({
  wood: '#5b351d',
  woodEdge: '#3d2517',
  woodTop: '#795034',
  woodWear: '#956846',
  parchment: '#eee2c4',
  parchmentEdge: '#c5aa75',
  ink: '#243d3a',
  fadedInk: '#486760',
  copper: '#9a6737',
  brass: '#9a7a43',
  steel: '#666963',
  darkSteel: '#3f443f',
  glass: '#cad9d2',
  wax: '#e7d9b5',
  blueprint: '#829f9d',
  blueprintInk: '#e3eee7',
});

function Timber({ name, position, size, color = COLORS.wood, rotation = [0, 0, 0] }) {
  return (
    <mesh name={name} position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.87} />
    </mesh>
  );
}

function DeskFrame({ kind }) {
  const dimensions = ATELIER_DESK_LAYOUT[kind];
  const { width, depth, leg } = dimensions;
  const topBottom = ATELIER_DESK_LAYOUT.topCenterY - ATELIER_DESK_LAYOUT.topThickness / 2;
  const floorY = ATELIER_DESK_LAYOUT.floorY;
  const legHeight = topBottom - floorY;
  const legCenter = floorY + legHeight / 2;
  const legX = width / 2 - leg * 0.9;
  const legZ = depth / 2 - leg * 0.9;
  const apronHeight = kind === 'mechanics' ? 0.2 : 0.17;
  const apronY = topBottom - apronHeight / 2 + 0.012;
  const lowerStretcherY = floorY + 0.31;
  const frontZ = depth / 2 - leg * 0.55;
  const rearZ = -frontZ;

  return (
    <group name={`${kind}-desk-frame`}>
      <Timber
        name={`${kind}-desktop`}
        position={[0, ATELIER_DESK_LAYOUT.topCenterY, 0]}
        size={[width, ATELIER_DESK_LAYOUT.topThickness, depth]}
        color={COLORS.wood}
      />
      <Timber
        name={`${kind}-desktop-inlay`}
        position={[0, ATELIER_DESK_LAYOUT.topCenterY + 0.057, 0]}
        size={[width * 0.91, 0.014, depth * 0.84]}
        color={COLORS.woodTop}
      />
      <Timber
        name={`${kind}-front-edge`}
        position={[0, ATELIER_DESK_LAYOUT.topCenterY + 0.005, depth / 2 - 0.018]}
        size={[width + 0.025, 0.115, 0.045]}
        color={COLORS.woodEdge}
      />
      {[
        ['left-front', -legX, frontZ],
        ['right-front', legX, frontZ],
        ['left-rear', -legX, rearZ],
        ['right-rear', legX, rearZ],
      ].map(([label, x, z]) => (
        <group key={label} position={[x, legCenter, z]}>
          <Timber
            name={`${kind}-leg-${label}`}
            position={[0, 0, 0]}
            size={[leg, legHeight, leg]}
            color={label.includes('front') ? COLORS.woodTop : COLORS.wood}
          />
          <Timber
            name={`${kind}-leg-foot-${label}`}
            position={[0, -legHeight / 2 + 0.035, 0]}
            size={[leg * 1.08, 0.07, leg * 1.08]}
            color={COLORS.woodEdge}
          />
        </group>
      ))}
      <Timber
        name={`${kind}-front-apron`}
        position={[0, apronY, frontZ]}
        size={[width - leg * 1.35, apronHeight, 0.075]}
        color={COLORS.woodTop}
      />
      <Timber
        name={`${kind}-rear-apron`}
        position={[0, apronY, rearZ]}
        size={[width - leg * 1.35, apronHeight, 0.075]}
        color={COLORS.wood}
      />
      {[-legX, legX].map((x, index) => (
        <Timber
          key={x}
          name={`${kind}-${index === 0 ? 'left' : 'right'}-apron`}
          position={[x, apronY, 0]}
          size={[0.075, apronHeight, depth - leg * 1.35]}
          color={COLORS.wood}
        />
      ))}
      <Timber
        name={`${kind}-lower-rear-stretcher`}
        position={[0, lowerStretcherY, rearZ]}
        size={[width - leg * 1.45, 0.1, 0.09]}
        color={COLORS.woodEdge}
      />
      {kind === 'mechanics' ? (
        <Timber
          name="mechanics-lower-side-stretcher"
          position={[legX, lowerStretcherY, 0]}
          size={[0.09, 0.1, depth - leg * 1.45]}
          color={COLORS.woodEdge}
        />
      ) : null}
    </group>
  );
}

function Paper({ name, position, size, rotation = 0, color = COLORS.parchment, children }) {
  const [width, depth] = size;
  return (
    <group
      name={name}
      position={position}
      rotation={[0, rotation, 0]}
      userData={{ qaTopProp: true, contactSurfaceY: ATELIER_DESK_LAYOUT.topSurfaceY }}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, 0.012, depth]} />
        <meshStandardMaterial color={color} roughness={0.94} />
      </mesh>
      <mesh position={[-width / 2 + 0.018, 0.008, depth / 2 - 0.018]}>
        <boxGeometry args={[0.045, 0.006, 0.045]} />
        <meshStandardMaterial color={COLORS.parchmentEdge} roughness={0.95} />
      </mesh>
      {children}
    </group>
  );
}

function InkLine({ position, size, rotation = 0, color = COLORS.ink }) {
  return (
    <mesh position={position} rotation={[0, rotation, 0]}>
      <boxGeometry args={[size[0], 0.004, size[1]]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

function RingInk({ position = [0, 0.012, 0], radius, color = COLORS.ink, arc = Math.PI * 2 }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.006, 6, 48, arc]} />
      <meshStandardMaterial color={color} roughness={0.78} />
    </mesh>
  );
}

export function OpenSpellpad({
  onClick,
  position = [-0.27, ATELIER_DESK_LAYOUT.topSurfaceY, 0.03],
  rotation = [0, 0.08, 0],
}) {
  const surface = ATELIER_DESK_LAYOUT.topSurfaceY;
  return (
    <group
      name="atelier-spellpad"
      position={position}
      rotation={rotation}
      userData={{ atelierInteraction: 'spellpad', qaTopProp: true, contactSurfaceY: position[1] }}
      onClick={onClick}
    >
      <mesh name="spellpad-back-cover" position={[0, 0.014, 0]} castShadow>
        <boxGeometry args={[0.72, 0.028, 0.48]} />
        <meshStandardMaterial color="#304a47" roughness={0.8} />
      </mesh>
      <group position={[-0.177, 0.045, 0]} rotation={[0, 0, -0.045]}>
        <mesh name="spellpad-left-page" castShadow receiveShadow>
          <boxGeometry args={[0.34, 0.018, 0.44]} />
          <meshStandardMaterial color="#eadcba" roughness={0.94} />
        </mesh>
        <FlatSpellInk
          name="spellpad-construction-ink"
          width={0.32}
          depth={0.42}
          surfaceY={0.009}
          variant="construction"
        />
      </group>
      <group position={[0.177, 0.045, 0]} rotation={[0, 0, 0.045]}>
        <mesh name="spellpad-right-page" castShadow receiveShadow>
          <boxGeometry args={[0.34, 0.018, 0.44]} />
          <meshStandardMaterial color="#f0e4c7" roughness={0.94} />
        </mesh>
        <FlatSpellInk
          name="spellpad-water-column-ink"
          width={0.32}
          depth={0.42}
          surfaceY={0.009}
          variant="complete"
        />
      </group>
      <mesh name="spellpad-spine" position={[0, 0.057, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.017, 0.02, 0.46, 12]} />
        <meshStandardMaterial color="#704927" roughness={0.86} />
      </mesh>
      {[-0.14, -0.045, 0.05, 0.145].map((z) => (
        <mesh key={z} position={[0, 0.064, z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.018, 0.003, 6, 16]} />
          <meshStandardMaterial color={COLORS.copper} metalness={0.48} roughness={0.46} />
        </mesh>
      ))}
    </group>
  );
}

function SpellStudySheet({ position, rotation = 0, incomplete = true }) {
  return (
    <Paper
      name="spell-study-sheet"
      position={position}
      rotation={rotation}
      size={[0.42, 0.38]}
    >
      <FlatSpellInk
        name={incomplete ? 'spell-study-incomplete-ink' : 'spell-study-complete-ink'}
        width={0.4}
        depth={0.36}
        surfaceY={0.006}
        variant={incomplete ? 'incomplete' : 'complete'}
      />
    </Paper>
  );
}

function FlatSpellInk({ name, width, depth, surfaceY, variant }) {
  const texture = useMemo(() => makeSpellInkTexture(variant), [variant]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return (
    <mesh
      name={name}
      position={[0, surfaceY + 0.00045, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      userData={{ flatSpellInk: true, clearance: 0.00045, variant }}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.04}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function makeSpellInkTexture(variant) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const ink = '#243d3a';
  const faded = '#54706a';

  if (variant === 'construction') {
    const studies = [
      { x: 215, y: 300, radius: 112, arc: Math.PI * 1.58 },
      { x: 545, y: 300, radius: 112, arc: Math.PI * 2 },
      { x: 215, y: 695, radius: 112, arc: Math.PI * 2 },
    ];
    context.strokeStyle = faded;
    context.lineWidth = 11;
    studies.forEach((study, index) => {
      context.beginPath();
      context.arc(study.x, study.y, study.radius, -Math.PI / 2, -Math.PI / 2 + study.arc);
      context.stroke();
      if (index > 0) {
        context.beginPath();
        context.arc(study.x, study.y, study.radius * 0.62, 0, Math.PI * 2);
        context.stroke();
      }
    });
    drawCanvasGlyph(context, 'sigil.water', {
      x: 545,
      y: 300,
      scale: 92,
      color: ink,
    });
    drawCanvasGlyph(context, 'sigil.water', {
      x: 215,
      y: 695,
      scale: 92,
      color: ink,
    });
    context.beginPath();
    context.moveTo(420, 655);
    context.lineTo(620, 760);
    context.moveTo(430, 730);
    context.lineTo(585, 690);
    context.stroke();
    return finishCanvasTexture(canvas);
  }

  const incomplete = variant === 'incomplete';
  const centerX = 384;
  const centerY = 540;
  context.strokeStyle = ink;
  context.lineWidth = 12;
  context.beginPath();
  context.arc(
    centerX,
    centerY,
    265,
    -Math.PI / 2,
    incomplete ? -Math.PI / 2 + Math.PI * 1.63 : Math.PI * 1.5,
  );
  context.stroke();
  context.strokeStyle = faded;
  context.lineWidth = 9;
  context.beginPath();
  context.arc(centerX, centerY, 190, 0, Math.PI * 2);
  context.stroke();
  drawCanvasGlyph(context, 'sigil.water', {
    x: centerX,
    y: centerY + 25,
    scale: 125,
    color: ink,
  });
  drawCanvasGlyph(context, 'sign.column', {
    x: centerX,
    y: centerY - 188,
    scale: 480,
    rotation: Math.PI,
    color: ink,
    size: 100,
    availableGap: 1,
  });
  if (!incomplete) {
    context.strokeStyle = ink;
    context.lineWidth = 9;
    context.beginPath();
    context.moveTo(175, 750);
    context.lineTo(225, 700);
    context.moveTo(593, 700);
    context.lineTo(643, 750);
    context.stroke();
  }
  return finishCanvasTexture(canvas);
}

function drawCanvasGlyph(context, glyphId, {
  x,
  y,
  scale,
  rotation = 0,
  color,
  size,
  availableGap,
}) {
  const geometry = resolveGlyphGeometry(glyphId, { size, availableGap });
  if (!geometry) return;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(scale, -scale);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = geometry.strokeWidth;
  geometry.primitives.forEach((primitive) => {
    context.beginPath();
    if (primitive.type === 'circle') {
      context.arc(primitive.cx, primitive.cy, primitive.r, 0, Math.PI * 2);
      if (primitive.fill) context.fill();
      else context.stroke();
      return;
    }
    primitive.commands.forEach((command) => {
      if (command.op === 'M') context.moveTo(command.x, command.y);
      else if (command.op === 'L') context.lineTo(command.x, command.y);
      else if (command.op === 'C') {
        context.bezierCurveTo(
          command.x1,
          command.y1,
          command.x2,
          command.y2,
          command.x,
          command.y,
        );
      } else if (command.op === 'Q') {
        context.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
      } else if (command.op === 'Z') context.closePath();
    });
    context.stroke();
  });
  context.restore();
}

function finishCanvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function GroundedBottle({ name, position, height, radius, liquid, fillRatio = 0.62 }) {
  const bodyHeight = height * 0.76;
  const bodyBottom = 0;
  const liquidHeight = bodyHeight * fillRatio;
  const liquidCenter = bodyBottom + liquidHeight / 2;
  return (
    <group name={name} position={position} userData={{ qaTopProp: true, contactSurfaceY: position[1] }}>
      <mesh position={[0, height * 0.38, 0]} castShadow>
        <cylinderGeometry args={[radius * 0.78, radius, height * 0.76, 20]} />
        <meshPhysicalMaterial
          color={COLORS.glass}
          roughness={0.15}
          transmission={0.25}
          transparent
          opacity={0.62}
        />
      </mesh>
      <mesh position={[0, liquidCenter, 0]}>
        <cylinderGeometry args={[radius * 0.73, radius * 0.9, liquidHeight, 24]} />
        <meshPhysicalMaterial
          color={liquid}
          roughness={0.24}
          transmission={0.04}
          transparent
          opacity={0.93}
        />
      </mesh>
      <mesh position={[0, liquidHeight + 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.72, 24]} />
        <meshPhysicalMaterial
          color={liquid}
          roughness={0.16}
          clearcoat={0.7}
          clearcoatRoughness={0.18}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, height * 0.83, 0]} castShadow>
        <cylinderGeometry args={[radius * 0.48, radius * 0.65, height * 0.18, 16]} />
        <meshPhysicalMaterial color={COLORS.glass} roughness={0.18} transparent opacity={0.65} />
      </mesh>
      <mesh position={[0, height * 0.96, 0]}>
        <cylinderGeometry args={[radius * 0.5, radius * 0.56, 0.045, 12]} />
        <meshStandardMaterial color="#765135" roughness={0.86} />
      </mesh>
      <mesh position={[0, height * 0.42, radius * 0.94]}>
        <boxGeometry args={[radius * 0.85, height * 0.25, 0.004]} />
        <meshStandardMaterial color="#d8c69e" roughness={0.94} />
      </mesh>
    </group>
  );
}

function GroundedCandle({ position }) {
  return (
    <group name="grounded-candle" position={position} userData={{ qaTopProp: true, contactSurfaceY: position[1] }}>
      <mesh position={[0, 0.009, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.08, 0.018, 24]} />
        <meshStandardMaterial color={COLORS.copper} metalness={0.5} roughness={0.43} />
      </mesh>
      <mesh position={[0, 0.085, 0]} castShadow>
        <cylinderGeometry args={[0.038, 0.046, 0.15, 18]} />
        <meshStandardMaterial color={COLORS.wax} roughness={0.68} />
      </mesh>
      <mesh position={[0.025, 0.075, 0.035]} rotation={[0.1, 0, 0.2]}>
        <capsuleGeometry args={[0.006, 0.055, 4, 8]} />
        <meshStandardMaterial color="#d3c49e" roughness={0.74} />
      </mesh>
      <mesh position={[0, 0.175, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.03, 6]} />
        <meshStandardMaterial color="#302824" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.215, 0]} scale={[0.7, 1.25, 0.7]}>
        <sphereGeometry args={[0.022, 12, 10]} />
        <meshStandardMaterial color="#ffd591" emissive="#ff9f3f" emissiveIntensity={2.1} />
      </mesh>
      <pointLight position={[0, 0.22, 0]} color="#ffc48b" intensity={1.45} distance={2} decay={2} />
    </group>
  );
}

export function MortarAndPestle({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) {
  const profile = useMemo(() => [
    new THREE.Vector2(0.052, 0),
    new THREE.Vector2(0.076, 0.012),
    new THREE.Vector2(0.096, 0.066),
    new THREE.Vector2(0.105, 0.108),
    new THREE.Vector2(0.076, 0.108),
    new THREE.Vector2(0.066, 0.078),
    new THREE.Vector2(0.042, 0.038),
    new THREE.Vector2(0.052, 0),
  ], []);

  return (
    <group
      name="mortar-and-pestle"
      position={position}
      rotation={rotation}
      userData={{
        qaTopProp: true,
        contactSurfaceY: position[1],
        mortarCavity: true,
        cavityDepth: 0.068,
      }}
    >
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 36]} />
        <meshStandardMaterial color="#777267" roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.109, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.09, 0.014, 10, 36]} />
        <meshStandardMaterial color="#817b6e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.047, 28]} />
        <meshStandardMaterial color="#315a58" roughness={0.82} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.004, 0.053, -0.005]} scale={[1, 0.2, 0.82]}>
        <sphereGeometry args={[0.032, 18, 10]} />
        <meshStandardMaterial color="#244846" roughness={0.9} />
      </mesh>
      <mesh position={[0.035, 0.152, -0.005]} rotation={[0, 0, -0.54]} castShadow>
        <capsuleGeometry args={[0.018, 0.18, 5, 10]} />
        <meshStandardMaterial color="#5e5c56" roughness={0.86} />
      </mesh>
    </group>
  );
}

export function InkpotAndQuill({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) {
  const inkSurfaceY = 0.092;
  const shaftBottomY = 0.026;
  const insertionDepth = inkSurfaceY - shaftBottomY;
  return (
    <group
      name="inkpot-and-quill"
      position={position}
      rotation={rotation}
      userData={{
        qaTopProp: true,
        contactSurfaceY: position[1],
        quillInkAssembly: true,
        inkSurfaceY,
        shaftBottomY,
        insertionDepth,
      }}
    >
      <mesh position={[0, 0.055, 0]} castShadow>
        <cylinderGeometry args={[0.052, 0.066, 0.11, 16]} />
        <meshPhysicalMaterial
          color="#9bb2ad"
          roughness={0.13}
          transmission={0.35}
          transparent
          opacity={0.55}
          thickness={0.016}
        />
      </mesh>
      <mesh position={[0, inkSurfaceY / 2, 0]}>
        <cylinderGeometry args={[0.043, 0.057, inkSurfaceY, 22]} />
        <meshStandardMaterial color="#172d35" roughness={0.3} />
      </mesh>
      <mesh position={[0, inkSurfaceY + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.043, 24]} />
        <meshPhysicalMaterial color="#1c3d49" roughness={0.12} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.096, 0]} castShadow>
        <cylinderGeometry args={[0.047, 0.049, 0.044, 20, 1, true]} />
        <meshPhysicalMaterial
          color="#a8bbb5"
          roughness={0.12}
          transmission={0.42}
          transparent
          opacity={0.48}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.113, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.042, 0.008, 6, 18]} />
        <meshStandardMaterial color={COLORS.copper} metalness={0.42} roughness={0.5} />
      </mesh>
      <group position={[0.008, 0.251, 0]} rotation={[0.04, 0.05, -0.1]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.0045, 0.008, 0.45, 10]} />
          <meshStandardMaterial color="#ded5c1" roughness={0.76} />
        </mesh>
        <mesh position={[0, -0.205, 0]} castShadow>
          <cylinderGeometry args={[0.0048, 0.0075, 0.04, 10]} />
          <meshStandardMaterial color="#172d35" roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.229, 0]} scale={[0.45, 1, 0.28]}>
          <coneGeometry args={[0.009, 0.025, 5]} />
          <meshStandardMaterial color="#18292e" metalness={0.25} roughness={0.5} />
        </mesh>
        {[-0.04, 0.012, 0.064, 0.116].map((y, index) => (
          <group key={y} position={[0, y + 0.055, 0]}>
            <mesh position={[0.045, 0, 0]} rotation={[0, 0, -0.48]}>
              <coneGeometry args={[0.026, 0.11, 3]} />
              <meshStandardMaterial
                color={index % 2 ? '#e9e1d0' : '#cfc8ba'}
                roughness={0.82}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh position={[-0.045, 0, 0]} rotation={[0, 0, 0.48]}>
              <coneGeometry args={[0.026, 0.11, 3]} />
              <meshStandardMaterial
                color={index % 2 ? '#cfc8ba' : '#e9e1d0'}
                roughness={0.82}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function DraftingCompass({ position, rotation = 0 }) {
  const legLength = 0.29;
  return (
    <group
      name="writing-drafting-compass"
      position={position}
      rotation={[0, rotation, 0]}
      userData={{ qaTopProp: true, contactSurfaceY: position[1] }}
    >
      <mesh position={[0, 0.028, -0.11]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.026, 18]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.66} roughness={0.34} />
      </mesh>
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[side * 0.062, 0.028, 0.015]}
          rotation={[0, side * 0.27, 0]}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.008, 0.012, legLength, 8]} />
            <meshStandardMaterial color={COLORS.brass} metalness={0.68} roughness={0.36} />
          </mesh>
          <mesh position={[0, 0, legLength / 2 + 0.017]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.008, 0.04, 7]} />
            <meshStandardMaterial
              color={side < 0 ? '#4c4b48' : COLORS.steel}
              metalness={side > 0 ? 0.7 : 0.1}
              roughness={0.48}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.03, -0.11]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.045, 10]} />
        <meshStandardMaterial color={COLORS.steel} metalness={0.72} roughness={0.3} />
      </mesh>
    </group>
  );
}

function GroundedScroll({ position, rotation = 0, length = 0.32 }) {
  const radius = 0.034;
  return (
    <group name="grounded-scroll" position={position} rotation={[0, rotation, 0]} userData={{ qaTopProp: true, contactSurfaceY: position[1] }}>
      <mesh position={[0, radius, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[radius, radius, length, 14]} />
        <meshStandardMaterial color={COLORS.parchment} roughness={0.9} />
      </mesh>
      {[-length / 2 + 0.025, length / 2 - 0.025].map((x) => (
        <mesh key={x} position={[x, radius * 1.04 + 0.007, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[radius * 1.04, 0.007, 6, 16]} />
          <meshStandardMaterial color={COLORS.parchmentEdge} roughness={0.75} />
        </mesh>
      ))}
    </group>
  );
}

function Cogwheel({ name, position, radius, teeth, color = COLORS.brass, thickness = 0.035 }) {
  return (
    <group name={name} position={position} userData={{ qaTopProp: true, contactSurfaceY: position[1] }}>
      <mesh position={[0, thickness / 2, 0]} castShadow>
        <cylinderGeometry args={[radius * 0.72, radius * 0.72, thickness, Math.max(16, teeth * 2)]} />
        <meshStandardMaterial color={color} metalness={0.68} roughness={0.42} />
      </mesh>
      {Array.from({ length: teeth }, (_, index) => {
        const angle = (index / teeth) * Math.PI * 2;
        return (
          <mesh
            key={index}
            position={[
              Math.cos(angle) * radius * 0.87,
              thickness / 2,
              Math.sin(angle) * radius * 0.87,
            ]}
            rotation={[0, -angle, 0]}
            castShadow
          >
            <boxGeometry args={[radius * 0.25, thickness, radius * 0.19]} />
            <meshStandardMaterial color={color} metalness={0.68} roughness={0.42} />
          </mesh>
        );
      })}
      <mesh position={[0, thickness + 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 0.21, radius * 0.065, 6, 18]} />
        <meshStandardMaterial color={COLORS.darkSteel} metalness={0.72} roughness={0.38} />
      </mesh>
    </group>
  );
}

function PartsTray({ position }) {
  return (
    <group name="parts-tray" position={position} userData={{ qaTopProp: true, contactSurfaceY: position[1] }}>
      <mesh position={[0, 0.014, 0]} castShadow>
        <boxGeometry args={[0.28, 0.028, 0.2]} />
        <meshStandardMaterial color="#4a3727" roughness={0.88} />
      </mesh>
      {[
        [0, 0.042, -0.095, 0.29, 0.03],
        [0, 0.042, 0.095, 0.29, 0.03],
        [-0.135, 0.042, 0, 0.03, 0.2],
        [0.135, 0.042, 0, 0.03, 0.2],
      ].map(([x, y, z, width, depth], index) => (
        <mesh key={index} position={[x, y, z]} castShadow>
          <boxGeometry args={[width, 0.07, depth]} />
          <meshStandardMaterial color={COLORS.woodEdge} roughness={0.88} />
        </mesh>
      ))}
      {[
        [-0.075, 0.055, -0.035],
        [0.065, 0.055, 0.035],
      ].map((entry, index) => (
        <mesh key={index} position={entry} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.024, 0.006, 6, 14]} />
          <meshStandardMaterial color={COLORS.steel} metalness={0.72} roughness={0.4} />
        </mesh>
      ))}
      <TrayScrew position={[-0.015, 0.042, -0.04]} rotation={0.22} />
      <TrayScrew position={[0.02, 0.042, 0.045]} rotation={-0.45} />
    </group>
  );
}

function TrayScrew({ position, rotation }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.006, 0.006, 0.09, 8]} />
        <meshStandardMaterial color={COLORS.steel} metalness={0.75} roughness={0.38} />
      </mesh>
      <mesh position={[0.052, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.014, 10]} />
        <meshStandardMaterial color={COLORS.steel} metalness={0.75} roughness={0.38} />
      </mesh>
    </group>
  );
}

function ForgedWrench({ position, rotation = 0, scale = 1 }) {
  const shape = useMemo(() => {
    const outline = new THREE.Shape();
    outline.moveTo(-0.25, 0.085);
    outline.lineTo(-0.16, 0.04);
    outline.lineTo(0.14, 0.032);
    outline.lineTo(0.19, 0.067);
    outline.lineTo(0.25, 0.038);
    outline.lineTo(0.22, 0);
    outline.lineTo(0.25, -0.038);
    outline.lineTo(0.19, -0.067);
    outline.lineTo(0.14, -0.032);
    outline.lineTo(-0.16, -0.04);
    outline.lineTo(-0.25, -0.085);
    outline.lineTo(-0.215, -0.018);
    outline.lineTo(-0.145, 0);
    outline.lineTo(-0.215, 0.018);
    outline.closePath();
    const hole = new THREE.Path();
    hole.absellipse(0.195, 0, 0.024, 0.024, 0, Math.PI * 2, false);
    outline.holes.push(hole);
    return outline;
  }, []);
  return (
    <group
      name="forged-wrench"
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale}
      userData={{ qaTopProp: true, contactSurfaceY: position[1] }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <extrudeGeometry args={[shape, {
          depth: 0.026,
          bevelEnabled: true,
          bevelSegments: 1,
          bevelSize: 0.005,
          bevelThickness: 0.004,
        }]} />
        <meshStandardMaterial color={COLORS.steel} metalness={0.7} roughness={0.42} />
      </mesh>
    </group>
  );
}

function BlueprintDiagram() {
  const ink = COLORS.blueprintInk;
  return (
    <group name="two-gear-blueprint" position={[0, 0.014, 0]}>
      <RingInk position={[-0.1, 0.012, 0.015]} radius={0.092} color={ink} />
      <RingInk position={[0.09, 0.012, 0.015]} radius={0.065} color={ink} />
      <RingInk position={[-0.1, 0.012, 0.015]} radius={0.018} color={ink} />
      <RingInk position={[0.09, 0.012, 0.015]} radius={0.014} color={ink} />
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index / 8) * Math.PI * 2;
        return (
          <InkLine
            key={`left-${index}`}
            position={[-0.1 + Math.cos(angle) * 0.105, 0.012, 0.015 + Math.sin(angle) * 0.105]}
            size={[0.025, 0.006]}
            rotation={-angle}
            color={ink}
          />
        );
      })}
      {Array.from({ length: 7 }, (_, index) => {
        const angle = (index / 7) * Math.PI * 2;
        return (
          <InkLine
            key={`right-${index}`}
            position={[0.09 + Math.cos(angle) * 0.077, 0.012, 0.015 + Math.sin(angle) * 0.077]}
            size={[0.02, 0.006]}
            rotation={-angle}
            color={ink}
          />
        );
      })}
      <InkLine position={[-0.005, 0.012, -0.15]} size={[0.39, 0.005]} color={ink} />
      <InkLine position={[-0.2, 0.012, -0.15]} size={[0.005, 0.055]} color={ink} />
      <InkLine position={[0.19, 0.012, -0.15]} size={[0.005, 0.055]} color={ink} />
      <InkLine position={[-0.005, 0.012, 0.15]} size={[0.36, 0.005]} color={ink} />
      <InkLine position={[-0.185, 0.012, 0.135]} size={[0.005, 0.035]} color={ink} />
      <InkLine position={[0.175, 0.012, 0.135]} size={[0.005, 0.035]} color={ink} />
      <mesh position={[-0.18, 0.016, -0.15]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.012, 0.025, 4]} />
        <meshStandardMaterial color={ink} roughness={0.8} />
      </mesh>
      <mesh position={[0.17, 0.016, -0.15]} rotation={[Math.PI / 2, 0, Math.PI / 2]}>
        <coneGeometry args={[0.012, 0.025, 4]} />
        <meshStandardMaterial color={ink} roughness={0.8} />
      </mesh>
    </group>
  );
}

function MechanicalSketchSheet({ position, rotation = 0 }) {
  return (
    <Paper
      name="mechanical-sketch-sheet"
      position={position}
      rotation={rotation}
      size={[0.32, 0.36]}
    >
      <group position={[0, 0.014, -0.04]}>
        <RingInk radius={0.065} color={COLORS.fadedInk} />
        <RingInk position={[0.1, 0.012, 0.065]} radius={0.038} color={COLORS.fadedInk} />
        <InkLine position={[-0.02, 0.012, 0.105]} size={[0.22, 0.006]} rotation={0.16} color={COLORS.fadedInk} />
        <InkLine position={[-0.035, 0.012, 0.135]} size={[0.15, 0.006]} rotation={-0.05} color={COLORS.fadedInk} />
      </group>
    </Paper>
  );
}

export function AtelierWritingDesk({
  spellpadAcquired = false,
  onSpellpadClick,
  showObjectiveMarker = false,
}) {
  const surface = ATELIER_DESK_LAYOUT.topSurfaceY;
  return (
    <group name="atelier-writing-desk-model">
      <DeskFrame kind="writing" />
      {!spellpadAcquired ? (
        <>
          <OpenSpellpad onClick={onSpellpadClick} />
          {showObjectiveMarker ? (
            <group name="spellpad-objective-marker" position={[-0.27, 1.76, 0.03]}>
              <mesh rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.075, 0.15, 4]} />
                <meshStandardMaterial color="#d4a641" emissive="#8f6824" emissiveIntensity={0.7} />
              </mesh>
              <mesh position={[0, 0.105, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.085, 0.011, 6, 24]} />
                <meshStandardMaterial color="#d4a641" emissive="#8f6824" emissiveIntensity={0.45} />
              </mesh>
            </group>
          ) : null}
        </>
      ) : (
        <SpellStudySheet position={[-0.27, surface + 0.006, 0.03]} rotation={0.08} incomplete={false} />
      )}
      <SpellStudySheet position={[0.55, surface + 0.006, 0.11]} rotation={-0.16} />
      <MortarAndPestle position={[-0.82, surface, -0.25]} />
      <GroundedScroll position={[-0.76, surface, 0.29]} rotation={0.34} />
      <InkpotAndQuill position={[0.14, surface, 0.27]} />
      <GroundedBottle
        name="writing-bottle-tall"
        position={[0.8, surface, -0.25]}
        height={0.22}
        radius={0.07}
        liquid="#376b68"
      />
      <GroundedBottle
        name="writing-bottle-small"
        position={[0.61, surface, -0.32]}
        height={0.16}
        radius={0.052}
        liquid="#8a4e35"
      />
      <GroundedCandle position={[0.2, surface, -0.31]} />
      <DraftingCompass position={[0.83, surface, 0.27]} rotation={0.08} />
    </group>
  );
}

export function AtelierMechanicsDesk({ onClick }) {
  const surface = ATELIER_DESK_LAYOUT.topSurfaceY;
  return (
    <group
      name="atelier-mechanics-desk-model"
      userData={{ atelierInteraction: 'workshop' }}
      onClick={onClick}
    >
      <DeskFrame kind="mechanics" />
      <Paper
        name="mechanics-blueprint"
        position={[-0.16, surface + 0.006, 0.03]}
        rotation={-0.04}
        size={[0.68, 0.42]}
        color={COLORS.blueprint}
      >
        <BlueprintDiagram />
      </Paper>
      <MechanicalSketchSheet position={[0.54, surface + 0.006, 0.16]} rotation={0.16} />
      <Cogwheel
        name="mechanics-cog-large"
        position={[0.5, surface, -0.21]}
        radius={0.115}
        teeth={12}
        color={COLORS.brass}
      />
      <Cogwheel
        name="mechanics-cog-medium"
        position={[0.68, surface, -0.07]}
        radius={0.073}
        teeth={10}
        color="#8b643b"
      />
      <Cogwheel
        name="mechanics-cog-small"
        position={[0.3, surface, -0.27]}
        radius={0.058}
        teeth={9}
        color={COLORS.steel}
      />
      <PartsTray position={[-0.67, surface, -0.22]} />
      <ForgedWrench position={[-0.42, surface, 0.29]} rotation={-0.08} scale={0.82} />
    </group>
  );
}
