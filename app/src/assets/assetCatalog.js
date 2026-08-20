import { PRIMITIVE_SHAPES } from '../../../src/mechanics-engine/index.js';

const SHAPE_MATERIALS = {
  cuboid: 'material.wood_light',
  beam: 'material.wood_light',
  plate: 'material.wood_heavy',
  sphere: 'material.stone',
  cylinder: 'material.iron',
  shaft: 'material.iron',
  wheel: 'material.wood_heavy',
  wedge: 'material.stone',
};

const shapeItems = Object.entries(PRIMITIVE_SHAPES).map(([preset, definition]) => ({
  id: `shape:${preset}`,
  paletteId: preset,
  category: 'Shapes',
  name: definition.label,
  assetKind: 'shape',
  preset,
  shape: definition.shape,
  size: { ...definition.defaultSize },
  materialId: SHAPE_MATERIALS[preset] ?? 'material.wood_light',
}));

export const ASSET_PALETTE = [
  ...shapeItems,
  {
    id: 'nature:tree-cedar',
    paletteId: 'nature-tree-cedar',
    category: 'Nature',
    name: 'Cedar tree',
    assetKind: 'tree',
    variant: 'cedar',
    size: { x: 1.2, y: 2.8, z: 1.2 },
    materialId: 'material.wood_heavy',
  },
  {
    id: 'nature:tree-round',
    paletteId: 'nature-tree-round',
    category: 'Nature',
    name: 'Round tree',
    assetKind: 'tree',
    variant: 'round',
    size: { x: 1.35, y: 2.35, z: 1.35 },
    materialId: 'material.wood_light',
  },
  {
    id: 'nature:rock-small',
    paletteId: 'nature-rock-small',
    category: 'Nature',
    name: 'Small rock',
    assetKind: 'rock',
    variant: 'small',
    size: { x: 0.75, y: 0.48, z: 0.62 },
    materialId: 'material.stone',
  },
  {
    id: 'nature:rock-flat',
    paletteId: 'nature-rock-flat',
    category: 'Nature',
    name: 'Flat rock',
    assetKind: 'rock',
    variant: 'flat',
    size: { x: 1.15, y: 0.34, z: 0.86 },
    materialId: 'material.stone',
  },
  {
    id: 'water-basin',
    paletteId: 'water-basin',
    category: 'Water basin',
    name: 'Water basin',
    assetKind: 'water-basin',
    size: { x: 1.1, y: 0.52, z: 1.1 },
    materialId: 'material.stone',
  },
];

export const ASSET_PALETTE_CATEGORIES = ['Shapes', 'Nature', 'Water basin'];

export function assetDefinitionForId(id) {
  return ASSET_PALETTE.find((item) => item.id === id) ?? null;
}
