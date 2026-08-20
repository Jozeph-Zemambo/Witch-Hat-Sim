import { cloneMechanicsDocument, createAssembly, createPrimitivePart } from './document.js';
import {
  collectHierarchyNodeIds,
  descendantPartIds,
  mapHierarchyNodeIds,
} from './hierarchy.js';
import {
  composeTransforms,
  inverseTransformDirection,
  inverseTransformPoint,
  relativeTransform,
  transformDirection,
  transformPoint,
} from './math.js';

export function glueAssemblies(document, assemblyIds, options = {}) {
  const selected = new Set(assemblyIds);
  const sources = document.assemblies.filter((assembly) => selected.has(assembly.assemblyId));
  if (sources.length < 2) {
    return { document: cloneMechanicsDocument(document), changed: false, reason: 'select_two_or_more_assemblies' };
  }

  const root = sources[0];
  const mergedId = options.assemblyId ?? root.assemblyId;
  const mergedTransform = root.transform;
  const mergedParts = [];
  const mappedStructures = new Map();
  const usedPartIds = new Set();
  let nextPartIndex = 1;
  for (const assembly of sources) {
    const partMap = new Map();
    for (const part of assembly.parts) {
      let partId = part.partId;
      while (usedPartIds.has(partId)) {
        partId = `${mergedId}:part-${nextPartIndex}`;
        nextPartIndex += 1;
      }
      usedPartIds.add(partId);
      partMap.set(part.partId, partId);
      const worldPart = composeTransforms(assembly.transform, part.localTransform);
      mergedParts.push({
        ...part,
        partId,
        localTransform: relativeTransform(mergedTransform, worldPart),
      });
    }
    mappedStructures.set(
      assembly.assemblyId,
      mapHierarchyNodeIds(assembly.structure, { part: partMap, node: new Map() }),
    );
  }
  const usedNodeIds = new Set(
    document.assemblies.flatMap((assembly) => collectHierarchyNodeIds(assembly.structure)),
  );
  const nextGroupId = (sourceId) => {
    const base = `node:${sourceId}`;
    let candidate = base;
    let index = 1;
    while (usedNodeIds.has(candidate) || mergedParts.some((part) => part.partId === candidate)) {
      index += 1;
      candidate = `${base}:${index}`;
    }
    usedNodeIds.add(candidate);
    return candidate;
  };
  const structure = {
    children: sources.map((assembly) => ({
      kind: 'assembly',
      nodeId: nextGroupId(assembly.assemblyId),
      label: assembly.label,
      localTransform: relativeTransform(mergedTransform, assembly.transform),
      children: cloneValue(mappedStructures.get(assembly.assemblyId)?.children ?? []),
    })),
  };
  const merged = createAssembly({
    ...root,
    assemblyId: mergedId,
    label: options.label ?? `${sources.length}-part assembly`,
    bodyMode: sources.some((assembly) => assembly.bodyMode === 'fixed') ? 'fixed' : 'dynamic',
    transform: mergedTransform,
    parts: mergedParts,
    structure,
    tags: [...new Set(sources.flatMap((assembly) => assembly.tags ?? []))],
  });

  const next = cloneMechanicsDocument(document);
  next.assemblies = [merged, ...next.assemblies.filter((assembly) => !selected.has(assembly.assemblyId))];
  next.constraints = remapConnections(next.constraints, selected, merged, sources, 'constraint');
  next.forceElements = remapConnections(next.forceElements, selected, merged, sources, 'force');
  next.sensors = next.sensors.map((sensor) => remapMountedItem(sensor, 'assemblyId', selected, merged, sources, 'localTransform'));
  next.latches = remapConnections(next.latches, selected, merged, sources, 'latch');
  next.spellDevices = next.spellDevices.map((device) => remapSpellDevice(device, selected, merged, sources));
  next.rotationCouplings = next.rotationCouplings
    .map((coupling) => {
      const nextCoupling = { ...coupling };
      if (selected.has(coupling.assemblyAId)) {
        const source = sources.find((entry) => entry.assemblyId === coupling.assemblyAId);
        nextCoupling.localAnchorA = coupling.localAnchorA
          ? convertLocalPoint(coupling.assemblyAId, coupling.localAnchorA, merged, sources)
          : null;
        nextCoupling.axisA = inverseTransformDirection(
          merged.transform,
          transformDirection(source.transform, coupling.axisA),
        );
        nextCoupling.assemblyAId = mergedId;
      }
      if (selected.has(coupling.assemblyBId)) {
        const source = sources.find((entry) => entry.assemblyId === coupling.assemblyBId);
        nextCoupling.localAnchorB = coupling.localAnchorB
          ? convertLocalPoint(coupling.assemblyBId, coupling.localAnchorB, merged, sources)
          : null;
        nextCoupling.axisB = inverseTransformDirection(
          merged.transform,
          transformDirection(source.transform, coupling.axisB),
        );
        nextCoupling.assemblyBId = mergedId;
      }
      return nextCoupling;
    })
    .filter((coupling) => coupling.assemblyAId !== coupling.assemblyBId);
  repairMechanicsReferences(next);
  next.metadata.revision = (next.metadata.revision ?? 0) + 1;

  return { document: next, changed: true, assemblyId: mergedId };
}

export function unglueAssembly(document, assemblyId) {
  const source = document.assemblies.find((assembly) => assembly.assemblyId === assemblyId);
  const immediateChildren = source?.structure?.children ?? [];
  if (!source || immediateChildren.length < 2) {
    return { document: cloneMechanicsDocument(document), changed: false, reason: 'assembly_not_glued' };
  }
  const next = cloneMechanicsDocument(document);
  const split = immediateChildren.map((child, index) => {
    const partIds = child.kind === 'shape'
      ? [child.partId]
      : descendantPartIds(source, child.nodeId);
    const childParts = partIds
      .map((partId) => source.parts.find((part) => part.partId === partId))
      .filter(Boolean);
    const childTransform = child.kind === 'assembly'
      ? composeTransforms(source.transform, child.localTransform)
      : composeTransforms(source.transform, childParts[0].localTransform);
    const parts = childParts.map((part) => {
      const worldPart = composeTransforms(source.transform, part.localTransform);
      return { ...part, localTransform: relativeTransform(childTransform, worldPart) };
    });
    return createAssembly({
      assemblyId: `${source.assemblyId}:part-${index + 1}`,
      label: child.kind === 'assembly' ? child.label : childParts[0]?.label,
      bodyMode: source.bodyMode,
      editor: source.editor,
      transform: childTransform,
      parts,
      structure: child.kind === 'assembly'
        ? { children: cloneValue(child.children) }
        : undefined,
      tags: source.tags,
    });
  });
  next.assemblies = [...next.assemblies.filter((assembly) => assembly.assemblyId !== assemblyId), ...split];
  next.constraints = next.constraints.filter(
    (item) => item.assemblyAId !== assemblyId && item.assemblyBId !== assemblyId,
  );
  next.forceElements = next.forceElements.filter(
    (item) => item.assemblyAId !== assemblyId && item.assemblyBId !== assemblyId,
  );
  next.sensors = next.sensors.filter((item) => item.assemblyId !== assemblyId);
  next.latches = next.latches.filter(
    (item) => item.assemblyAId !== assemblyId && item.assemblyBId !== assemblyId,
  );
  next.rotationCouplings = next.rotationCouplings.filter(
    (item) => item.assemblyAId !== assemblyId && item.assemblyBId !== assemblyId,
  );
  next.spellDevices = next.spellDevices.filter((item) => item.assemblyId !== assemblyId);
  next.metadata.revision = (next.metadata.revision ?? 0) + 1;
  return { document: next, changed: true, assemblyIds: split.map((item) => item.assemblyId) };
}

export function duplicateAssembly(document, assemblyId, nextAssemblyId, offset = { x: 0.6, y: 0, z: 0.6 }) {
  const source = document.assemblies.find((assembly) => assembly.assemblyId === assemblyId);
  if (!source) return { document: cloneMechanicsDocument(document), changed: false };
  const next = cloneMechanicsDocument(document);
  const partMap = new Map(
    source.parts.map((part, index) => [part.partId, `${nextAssemblyId}:part-${index + 1}`]),
  );
  const nodeMap = new Map(
    collectHierarchyNodeIds(source.structure)
      .filter((nodeId) => !partMap.has(nodeId))
      .map((nodeId, index) => [nodeId, `${nextAssemblyId}:node-${index + 1}`]),
  );
  const copy = createAssembly({
    ...source,
    assemblyId: nextAssemblyId,
    label: `${source.label} copy`,
    transform: {
      ...source.transform,
      position: {
        x: source.transform.position.x + offset.x,
        y: source.transform.position.y + offset.y,
        z: source.transform.position.z + offset.z,
      },
    },
    parts: source.parts.map((part) => ({ ...part, partId: partMap.get(part.partId) })),
    structure: mapHierarchyNodeIds(source.structure, { part: partMap, node: nodeMap }),
  });
  next.assemblies.push(copy);
  next.metadata.revision = (next.metadata.revision ?? 0) + 1;
  return { document: next, changed: true, assemblyId: nextAssemblyId };
}

export function removeMechanicsItem(document, itemId) {
  const next = cloneMechanicsDocument(document);
  const removedAssembly = next.assemblies.some((item) => item.assemblyId === itemId);
  next.assemblies = next.assemblies.filter((item) => item.assemblyId !== itemId);
  next.constraints = next.constraints.filter(
    (item) => item.constraintId !== itemId && item.assemblyAId !== itemId && item.assemblyBId !== itemId,
  );
  next.forceElements = next.forceElements.filter(
    (item) => item.forceElementId !== itemId && item.assemblyAId !== itemId && item.assemblyBId !== itemId,
  );
  next.sensors = next.sensors.filter((item) => item.sensorId !== itemId && item.assemblyId !== itemId);
  next.latches = next.latches.filter(
    (item) => item.latchId !== itemId && item.assemblyAId !== itemId && item.assemblyBId !== itemId,
  );
  next.rotationCouplings = next.rotationCouplings.filter(
    (item) => item.couplingId !== itemId && item.assemblyAId !== itemId && item.assemblyBId !== itemId,
  );
  const removedDevices = new Set(
    next.spellDevices
      .filter((item) => item.deviceId === itemId || item.assemblyId === itemId)
      .map((item) => item.deviceId),
  );
  next.spellDevices = next.spellDevices.filter((item) => item.deviceId !== itemId && item.assemblyId !== itemId);
  next.gates = next.gates.filter(
    (item) => item.gateId !== itemId && !removedDevices.has(item.plateDeviceId),
  );
  repairMechanicsReferences(next);
  next.metadata.revision = (next.metadata.revision ?? 0) + 1;
  return { document: next, changed: removedAssembly || JSON.stringify(next) !== JSON.stringify(document) };
}

export function copyMechanicsSelection(document, assemblyIds) {
  const selected = new Set(assemblyIds);
  const assemblies = document.assemblies.filter((item) => selected.has(item.assemblyId));
  const deviceIds = new Set(
    document.spellDevices.filter((item) => selected.has(item.assemblyId)).map((item) => item.deviceId),
  );
  const constraintIds = new Set(
    document.constraints
      .filter((item) => selected.has(item.assemblyAId) && selected.has(item.assemblyBId))
      .map((item) => item.constraintId),
  );
  const sensorIds = new Set(
    document.sensors.filter((item) => selected.has(item.assemblyId)).map((item) => item.sensorId),
  );
  return clone({
    assemblies,
    constraints: document.constraints.filter((item) => constraintIds.has(item.constraintId)),
    forceElements: document.forceElements.filter(
      (item) =>
        selected.has(item.assemblyAId) &&
        selected.has(item.assemblyBId) &&
        (!item.constraintId || constraintIds.has(item.constraintId)),
    ),
    sensors: document.sensors.filter((item) => sensorIds.has(item.sensorId)),
    latches: document.latches.filter(
      (item) =>
        selected.has(item.assemblyAId) &&
        selected.has(item.assemblyBId) &&
        (!item.releaseSensorId || sensorIds.has(item.releaseSensorId)),
    ),
    rotationCouplings: document.rotationCouplings.filter(
      (item) => selected.has(item.assemblyAId) && selected.has(item.assemblyBId),
    ),
    spellDevices: document.spellDevices.filter((item) => deviceIds.has(item.deviceId)),
    gates: document.gates.filter(
      (item) => deviceIds.has(item.plateDeviceId) && constraintIds.has(item.driverConstraintId),
    ),
  });
}

export function pasteMechanicsSelection(document, fragment, offset = { x: 0.8, y: 0, z: 0.8 }) {
  if (!fragment?.assemblies?.length) {
    return { document: cloneMechanicsDocument(document), changed: false, assemblyIds: [] };
  }
  const next = cloneMechanicsDocument(document);
  const maps = {
    assembly: new Map(),
    constraint: new Map(),
    spring: new Map(),
    sensor: new Map(),
    latch: new Map(),
    coupling: new Map(),
    device: new Map(),
    gate: new Map(),
  };
  allocateIds(next, fragment.assemblies, 'assemblyId', 'assembly', maps.assembly);
  allocateIds(next, fragment.constraints, 'constraintId', 'constraint', maps.constraint);
  allocateIds(next, fragment.forceElements, 'forceElementId', 'spring', maps.spring);
  allocateIds(next, fragment.sensors, 'sensorId', 'sensor', maps.sensor);
  allocateIds(next, fragment.latches, 'latchId', 'latch', maps.latch);
  allocateIds(next, fragment.rotationCouplings, 'couplingId', 'coupling', maps.coupling);
  allocateIds(next, fragment.spellDevices, 'deviceId', 'spell-device', maps.device);
  allocateIds(next, fragment.gates, 'gateId', 'gate', maps.gate);

  const assemblies = fragment.assemblies.map((assembly) => {
    const assemblyId = maps.assembly.get(assembly.assemblyId);
    const partMap = new Map(
      assembly.parts.map((part, index) => [part.partId, `${assemblyId}:part-${index + 1}`]),
    );
    const nodeMap = new Map(
      collectHierarchyNodeIds(assembly.structure)
        .filter((nodeId) => !partMap.has(nodeId))
        .map((nodeId, index) => [nodeId, `${assemblyId}:node-${index + 1}`]),
    );
    return {
      ...clone(assembly),
      assemblyId,
      label: `${assembly.label} copy`,
      transform: {
        ...clone(assembly.transform),
        position: addOffset(assembly.transform.position, offset),
      },
      parts: assembly.parts.map((part) => ({
        ...clone(part),
        partId: partMap.get(part.partId),
      })),
      structure: mapHierarchyNodeIds(assembly.structure, { part: partMap, node: nodeMap }),
    };
  });
  const constraints = fragment.constraints.map((item) => ({
    ...clone(item),
    constraintId: maps.constraint.get(item.constraintId),
    assemblyAId: maps.assembly.get(item.assemblyAId),
    assemblyBId: maps.assembly.get(item.assemblyBId),
  }));
  const forceElements = fragment.forceElements.map((item) => ({
    ...clone(item),
    forceElementId: maps.spring.get(item.forceElementId),
    assemblyAId: maps.assembly.get(item.assemblyAId),
    assemblyBId: maps.assembly.get(item.assemblyBId),
    constraintId: item.constraintId ? maps.constraint.get(item.constraintId) : null,
  }));
  const sensors = fragment.sensors.map((item) => ({
    ...clone(item),
    sensorId: maps.sensor.get(item.sensorId),
    assemblyId: maps.assembly.get(item.assemblyId),
  }));
  const latches = fragment.latches.map((item) => ({
    ...clone(item),
    latchId: maps.latch.get(item.latchId),
    assemblyAId: maps.assembly.get(item.assemblyAId),
    assemblyBId: maps.assembly.get(item.assemblyBId),
    releaseSensorId: item.releaseSensorId ? maps.sensor.get(item.releaseSensorId) : null,
  }));
  const rotationCouplings = fragment.rotationCouplings.map((item) => ({
    ...clone(item),
    couplingId: maps.coupling.get(item.couplingId),
    assemblyAId: maps.assembly.get(item.assemblyAId),
    assemblyBId: maps.assembly.get(item.assemblyBId),
  }));
  const spellDevices = fragment.spellDevices.map((item) => ({
    ...clone(item),
    deviceId: maps.device.get(item.deviceId),
    assemblyId: maps.assembly.get(item.assemblyId),
    gateId: item.gateId ? maps.gate.get(item.gateId) : null,
  }));
  const gates = fragment.gates.map((item) => ({
    ...clone(item),
    gateId: maps.gate.get(item.gateId),
    plateDeviceId: maps.device.get(item.plateDeviceId),
    driverConstraintId: maps.constraint.get(item.driverConstraintId),
  }));

  next.assemblies.push(...assemblies);
  next.constraints.push(...constraints);
  next.forceElements.push(...forceElements);
  next.sensors.push(...sensors);
  next.latches.push(...latches);
  next.rotationCouplings.push(...rotationCouplings);
  next.spellDevices.push(...spellDevices);
  next.gates.push(...gates);
  next.metadata.revision = (next.metadata.revision ?? 0) + 1;
  return { document: next, changed: true, assemblyIds: assemblies.map((item) => item.assemblyId) };
}

function remapConnections(items, selected, merged, sources, kind) {
  return items
    .map((item) => {
      const aInside = selected.has(item.assemblyAId);
      const bInside = selected.has(item.assemblyBId);
      if (aInside && bInside) return null;
      const next = { ...item };
      if (aInside) {
        next.localAnchorA = convertLocalPoint(item.assemblyAId, item.localAnchorA, merged, sources);
        if (item.connectionAnchorA) {
          next.connectionAnchorA = convertLocalPoint(
            item.assemblyAId,
            item.connectionAnchorA,
            merged,
            sources,
          );
        }
        next.assemblyAId = merged.assemblyId;
      }
      if (bInside) {
        next.localAnchorB = convertLocalPoint(item.assemblyBId, item.localAnchorB, merged, sources);
        if (item.connectionAnchorB) {
          next.connectionAnchorB = convertLocalPoint(
            item.assemblyBId,
            item.connectionAnchorB,
            merged,
            sources,
          );
        }
        next.assemblyBId = merged.assemblyId;
      }
      if (kind === 'constraint' && aInside) {
        const source = sources.find((entry) => entry.assemblyId === item.assemblyAId);
        const worldAxis = transformDirection(source.transform, item.localAxisA);
        next.localAxisA = inverseTransformDirection(merged.transform, worldAxis);
      }
      return next;
    })
    .filter(Boolean);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function remapMountedItem(item, field, selected, merged, sources, transformField) {
  if (!selected.has(item[field])) return item;
  const source = sources.find((entry) => entry.assemblyId === item[field]);
  return {
    ...item,
    [field]: merged.assemblyId,
    [transformField]: relativeTransform(
      merged.transform,
      composeTransforms(source.transform, item[transformField]),
    ),
  };
}

function remapSpellDevice(device, selected, merged, sources) {
  if (!selected.has(device.assemblyId)) return device;
  const source = sources.find((entry) => entry.assemblyId === device.assemblyId);
  const worldOrigin = transformPoint(source.transform, device.localFrame.origin);
  const worldNormal = transformDirection(source.transform, device.localFrame.normal);
  const worldTangent = transformDirection(source.transform, device.localFrame.tangent);
  return {
    ...device,
    assemblyId: merged.assemblyId,
    localFrame: {
      origin: inverseTransformPoint(merged.transform, worldOrigin),
      normal: inverseTransformDirection(merged.transform, worldNormal),
      tangent: inverseTransformDirection(merged.transform, worldTangent),
    },
  };
}

function convertLocalPoint(sourceId, point, merged, sources) {
  const source = sources.find((entry) => entry.assemblyId === sourceId);
  return inverseTransformPoint(merged.transform, transformPoint(source.transform, point));
}

function repairMechanicsReferences(document) {
  const constraintIds = new Set(document.constraints.map((item) => item.constraintId));
  const sensorIds = new Set(document.sensors.map((item) => item.sensorId));
  const deviceIds = new Set(document.spellDevices.map((item) => item.deviceId));

  document.forceElements = document.forceElements.filter(
    (item) => !item.constraintId || constraintIds.has(item.constraintId),
  );
  document.latches = document.latches.map((item) =>
    item.releaseSensorId && !sensorIds.has(item.releaseSensorId)
      ? { ...item, releaseSensorId: null }
      : item,
  );
  document.gates = document.gates.filter(
    (item) => deviceIds.has(item.plateDeviceId) && constraintIds.has(item.driverConstraintId),
  );
  const gateIds = new Set(document.gates.map((item) => item.gateId));
  document.spellDevices = document.spellDevices.map((item) =>
    item.gateId && !gateIds.has(item.gateId)
      ? { ...item, gateId: null }
      : item,
  );
}

function allocateIds(document, items = [], idField, prefix, map) {
  let numeric = Number(nextIdNumber(document, prefix));
  for (const item of items) {
    map.set(item[idField], `${prefix}:${numeric}`);
    numeric += 1;
  }
}

function nextIdNumber(document, prefix) {
  const values = [
    ...document.assemblies,
    ...document.constraints,
    ...document.forceElements,
    ...document.sensors,
    ...document.latches,
    ...document.rotationCouplings,
    ...document.spellDevices,
    ...document.gates,
  ].flatMap((item) => Object.values(item));
  let highest = 0;
  for (const value of values) {
    if (typeof value !== 'string' || !value.startsWith(`${prefix}:`)) continue;
    const number = Number(value.slice(prefix.length + 1));
    if (Number.isInteger(number)) highest = Math.max(highest, number);
  }
  return highest + 1;
}

function addOffset(position, offset) {
  return {
    x: position.x + offset.x,
    y: position.y + offset.y,
    z: position.z + offset.z,
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
