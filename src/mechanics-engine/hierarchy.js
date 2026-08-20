import { composeTransforms, relativeTransform } from './math.js';
import { normalizeTransform, sanitizeSize } from './document.js';

export function normalizeAssemblyStructure(structure, parts = []) {
  const partIds = new Set(parts.map((part) => part.partId));
  const usedPartIds = new Set();
  const usedNodeIds = new Set();

  const normalizeChildren = (children) =>
    (Array.isArray(children) ? children : []).flatMap((node) => {
      if (!node || typeof node !== 'object') return [];
      if (node.kind === 'shape') {
        const partId = String(node.partId ?? node.nodeId ?? '');
        if (!partIds.has(partId) || usedPartIds.has(partId)) return [];
        usedPartIds.add(partId);
        usedNodeIds.add(partId);
        return [{ kind: 'shape', nodeId: partId, partId }];
      }
      if (node.kind !== 'assembly') return [];
      const fallback = `group:${usedNodeIds.size + 1}`;
      let nodeId = String(node.nodeId ?? fallback);
      while (usedNodeIds.has(nodeId) || partIds.has(nodeId)) nodeId = `${nodeId}:nested`;
      usedNodeIds.add(nodeId);
      return [{
        kind: 'assembly',
        nodeId,
        label: String(node.label ?? 'Assembly'),
        localTransform: normalizeTransform(node.localTransform),
        children: normalizeChildren(node.children),
      }];
    });

  const children = normalizeChildren(structure?.children);
  for (const part of parts) {
    if (usedPartIds.has(part.partId)) continue;
    children.push({ kind: 'shape', nodeId: part.partId, partId: part.partId });
  }
  return { children };
}

export function assemblyChildren(assembly, nodeId = null) {
  if (!nodeId || nodeId === assembly.assemblyId) return assembly.structure?.children ?? [];
  return findAssemblyNode(assembly, nodeId)?.node?.children ?? [];
}

export function findAssemblyNode(assembly, nodeId) {
  if (!assembly || !nodeId) return null;
  const visit = (children, parentNode, parentRootTransform) => {
    for (const node of children ?? []) {
      if (node.kind === 'assembly') {
        const rootTransform = composeTransforms(parentRootTransform, node.localTransform);
        if (node.nodeId === nodeId) {
          return { node, parentNode, parentRootTransform, rootTransform };
        }
        const nested = visit(node.children, node, rootTransform);
        if (nested) return nested;
      } else if (node.kind === 'shape' && (node.nodeId === nodeId || node.partId === nodeId)) {
        const part = assembly.parts.find((item) => item.partId === node.partId);
        return {
          node,
          part,
          parentNode,
          parentRootTransform,
          rootTransform: part?.localTransform ?? parentRootTransform,
        };
      }
    }
    return null;
  };
  return visit(assembly.structure?.children, null, identityTransform());
}

export function assemblyNodeDescriptor(assembly, nodeId = null) {
  if (!nodeId || nodeId === assembly.assemblyId) {
    return {
      kind: 'assembly',
      nodeId: assembly.assemblyId,
      label: assembly.label,
      localTransform: assembly.transform,
      children: assembly.structure?.children ?? [],
      root: true,
    };
  }
  const found = findAssemblyNode(assembly, nodeId);
  if (!found) return null;
  if (found.node.kind === 'shape') {
    return {
      ...found,
      kind: 'shape',
      nodeId: found.node.nodeId,
      label: found.part?.label ?? 'Shape',
      localTransform: relativeTransform(found.parentRootTransform, found.part?.localTransform ?? identityTransform()),
      children: [],
      root: false,
    };
  }
  return {
    ...found,
    kind: 'assembly',
    nodeId: found.node.nodeId,
    label: found.node.label,
    localTransform: found.node.localTransform,
    children: found.node.children,
    root: false,
  };
}

export function descendantPartIds(assembly, nodeId = null) {
  const children = assemblyChildren(assembly, nodeId);
  const ids = [];
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.kind === 'shape') ids.push(node.partId);
      else visit(node.children);
    }
  };
  if (nodeId && nodeId !== assembly.assemblyId) {
    const found = findAssemblyNode(assembly, nodeId);
    if (found?.node.kind === 'shape') return [found.node.partId];
  }
  visit(children);
  return ids;
}

export function assemblyPartCount(assembly, nodeId = null) {
  return descendantPartIds(assembly, nodeId).length;
}

export function updateHierarchyNode(assembly, nodeId, patch = {}) {
  if (!assembly || !nodeId || nodeId === assembly.assemblyId) return assembly;
  const found = findAssemblyNode(assembly, nodeId);
  if (!found) return assembly;
  const next = structuredCloneValue(assembly);

  if (found.node.kind === 'shape') {
    const nextPart = next.parts.find((part) => part.partId === found.node.partId);
    if (!nextPart) return assembly;
    if (patch.label) nextPart.label = patch.label;
    if (patch.size) nextPart.size = sanitizeSize({ ...nextPart.size, ...patch.size });
    if (patch.materialId) nextPart.materialId = patch.materialId;
    if (patch.localTransform) {
      const local = {
        position: {
          ...relativeTransform(found.parentRootTransform, found.part.localTransform).position,
          ...(patch.localTransform.position ?? {}),
        },
        rotation: {
          ...relativeTransform(found.parentRootTransform, found.part.localTransform).rotation,
          ...(patch.localTransform.rotation ?? {}),
        },
      };
      nextPart.localTransform = composeTransforms(found.parentRootTransform, normalizeTransform(local));
    }
    return next;
  }

  const nextFound = findAssemblyNode(next, nodeId);
  const nextNode = nextFound?.node;
  if (!nextNode) return assembly;
  const oldRootTransform = found.rootTransform;
  const localTransform = patch.localTransform
    ? normalizeTransform({
        position: { ...found.node.localTransform.position, ...(patch.localTransform.position ?? {}) },
        rotation: { ...found.node.localTransform.rotation, ...(patch.localTransform.rotation ?? {}) },
      })
    : found.node.localTransform;
  const newRootTransform = composeTransforms(found.parentRootTransform, localTransform);
  const partIds = new Set(descendantPartIds(assembly, nodeId));
  for (const part of next.parts) {
    if (!partIds.has(part.partId)) continue;
    const inside = relativeTransform(oldRootTransform, part.localTransform);
    part.localTransform = composeTransforms(newRootTransform, inside);
  }
  if (patch.label) nextNode.label = patch.label;
  nextNode.localTransform = localTransform;
  return next;
}

export function scaleHierarchyNode(assembly, nodeId, scale) {
  const factors = {
    x: Math.max(0.05, Math.abs(Number(scale?.x ?? 1))),
    y: Math.max(0.05, Math.abs(Number(scale?.y ?? 1))),
    z: Math.max(0.05, Math.abs(Number(scale?.z ?? 1))),
  };
  const next = structuredCloneValue(assembly);
  const descriptor = assemblyNodeDescriptor(assembly, nodeId);
  if (!descriptor) return assembly;
  if (descriptor.kind === 'shape') {
    const part = next.parts.find((item) => item.partId === descriptor.nodeId);
    if (!part) return assembly;
    part.size = sanitizeSize({
      x: part.size.x * factors.x,
      y: part.size.y * factors.y,
      z: part.size.z * factors.z,
    });
    return next;
  }
  const rootTransform = descriptor.root ? identityTransform() : descriptor.rootTransform;
  const partIds = new Set(descendantPartIds(assembly, descriptor.nodeId));
  for (const part of next.parts) {
    if (!partIds.has(part.partId)) continue;
    const inside = relativeTransform(rootTransform, part.localTransform);
    inside.position = {
      x: inside.position.x * factors.x,
      y: inside.position.y * factors.y,
      z: inside.position.z * factors.z,
    };
    part.localTransform = composeTransforms(rootTransform, inside);
    part.size = sanitizeSize({
      x: part.size.x * factors.x,
      y: part.size.y * factors.y,
      z: part.size.z * factors.z,
    });
  }
  const targetChildren = descriptor.root
    ? next.structure?.children
    : findAssemblyNode(next, descriptor.nodeId)?.node?.children;
  scaleNestedGroupPositions(
    targetChildren,
    rootTransform,
    rootTransform,
    rootTransform,
    factors,
  );
  return next;
}

export function mapHierarchyNodeIds(structure, maps) {
  const mapChildren = (children) =>
    (children ?? []).map((node) => {
      if (node.kind === 'shape') {
        const partId = maps.part.get(node.partId) ?? node.partId;
        return { ...node, nodeId: partId, partId };
      }
      return {
        ...node,
        nodeId: maps.node.get(node.nodeId) ?? node.nodeId,
        children: mapChildren(node.children),
      };
    });
  return { children: mapChildren(structure?.children) };
}

export function collectHierarchyNodeIds(structure) {
  const ids = [];
  const visit = (children) => {
    for (const node of children ?? []) {
      ids.push(node.nodeId);
      if (node.kind === 'assembly') visit(node.children);
    }
  };
  visit(structure?.children);
  return ids;
}

export function nextHierarchyNodeId(document, label = 'assembly') {
  const used = new Set(
    (document.assemblies ?? []).flatMap((assembly) => collectHierarchyNodeIds(assembly.structure)),
  );
  let index = 1;
  let candidate = `node:${label}:${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `node:${label}:${index}`;
  }
  return candidate;
}

export function identityTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

function structuredCloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function scaleNestedGroupPositions(
  children,
  oldParentRoot,
  newParentRoot,
  scaleFrame,
  factors,
) {
  for (const node of children ?? []) {
    if (node.kind !== 'assembly') continue;
    const oldRoot = composeTransforms(oldParentRoot, node.localTransform);
    const inScaleFrame = relativeTransform(scaleFrame, oldRoot);
    inScaleFrame.position = {
      x: inScaleFrame.position.x * factors.x,
      y: inScaleFrame.position.y * factors.y,
      z: inScaleFrame.position.z * factors.z,
    };
    const newRoot = composeTransforms(scaleFrame, inScaleFrame);
    node.localTransform = relativeTransform(newParentRoot, newRoot);
    scaleNestedGroupPositions(node.children, oldRoot, newRoot, scaleFrame, factors);
  }
}
