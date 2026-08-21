import { compileSpell } from '../../../src/compiler/index.js';
import {
  createSceneProp,
  interpretCompiledSpell,
} from '../../../src/simulation-engine/index.js';
import {
  crossVector,
  normalizeVector,
  rotateVector,
  transformDirection,
  transformPoint,
} from '../../../src/mechanics-engine/index.js';

const COMPILED_TEMPLATES = new Map();
export const MECHANICS_SPELL_TEMPLATES = Object.freeze([
  {
    templateId: 'wind-column',
    label: 'Wind Column',
    description: 'A directed airflow column that can push physical parts.',
    fixture: materialColumnFixture('wind'),
  },
  {
    templateId: 'water-column',
    label: 'Water Column',
    description: 'A generated water column for gates, cams, and garden experiments.',
    fixture: materialColumnFixture('water'),
  },
  {
    templateId: 'earth-column',
    label: 'Earth Column',
    description: 'A generated stone-like pillar. Physical solid output remains experimental.',
    fixture: materialColumnFixture('earth'),
  },
  {
    templateId: 'light-column',
    label: 'Light Column',
    description: 'A source-free light beam with no force by default.',
    fixture: materialColumnFixture('light'),
  },
  {
    templateId: 'wind-pull',
    label: 'Wind Pull',
    description: 'Pulls the nearest compatible movable assembly toward the mounted plate.',
    fixture: windPullFixture(),
  },
  {
    templateId: 'wind-levitation',
    label: 'Wind Levitation',
    description: 'Supports and steers the assembly carrying the spell plate.',
    fixture: windLevitationFixture(),
  },
]);

export function evaluateMountedSpellDevices(document, snapshot, options = {}) {
  const fields = [];
  const devices = [];
  const runtimes = {};
  const manualActiveIds = options.manualActiveIds ?? new Set();

  for (const device of document.spellDevices ?? []) {
    const assemblyTransform = snapshot.assemblies?.[device.assemblyId];
    if (!assemblyTransform) continue;
    const gate = device.gateId ? snapshot.gates?.[device.gateId] : null;
    const manuallyActive = manualActiveIds.has(device.deviceId);
    const closed = gate ? gate.closed === true : manuallyActive;
    const frame = worldFrameForDevice(device, assemblyTransform);
    const compiled = compiledSpellForDevice(device);
    if (!compiled) {
      // An empty socket: the plate, its ring, and its gate all behave normally —
      // there is simply no glyph to cast until a spell is placed in the socket.
      devices.push({
        deviceId: device.deviceId,
        assemblyId: device.assemblyId,
        label: device.label,
        spellTemplateId: null,
        socketed: false,
        active: false,
        gateId: device.gateId,
        gateState: gate ?? null,
        gateClosed: closed,
        frame,
        outputIntents: [],
        lifecycle: null,
      });
      continue;
    }
    const mechanicalCompleter = {
      id: device.gateId ?? `manual-gate:${device.deviceId}`,
      propId: device.assemblyId,
      role: 'activation_ring_mechanical_key',
      completion: closed ? 1 : 0,
      seated: closed,
      distanceToGap: closed ? 0 : 1,
      keyPosition: frame.origin,
      gapPosition: frame.origin,
    };
    const runtime = interpretCompiledSpell({
      graph: compiled.graph,
      program: compiled.program,
      diagnostics: compiled.diagnostics,
      sceneState: mechanicsSceneState(document, snapshot, device.assemblyId, options.sceneState),
      options: {
        placementFrame: frame,
        activation: {
          active: true,
          mode: 'held',
          outerRingCompletion: 0,
          mechanicalCompleters: [mechanicalCompleter],
        },
      },
    });
    runtimes[device.deviceId] = runtime;
    const active = runtime.lifecycle?.active === true;
    const stoppingEffectIds = new Set(
      runtime.intents
        .filter(
          (intent) =>
            intent.intentType === 'effect_lifecycle' &&
            intent.operation === 'stop',
        )
        .map((intent) => intent.sourceIntentId),
    );
    const outputIntents = runtime.intents.filter(
      (intent) =>
        [
          'water_column',
          'material_column',
          'water_dispersion',
          'material_dispersion',
          'illumination',
          'force_constraint_debug',
          'physics_motion',
        ].includes(
          intent.intentType,
        ),
    ).map((intent) => ({
      ...intent,
      // Keep a render consumer alive when the simulation explicitly asks the
      // effect to stop. Renderers with an ending phase can then stop emission
      // and finish the material already in flight instead of being unmounted.
      deactivating: stoppingEffectIds.has(intent.id),
    }));
    devices.push({
      deviceId: device.deviceId,
      assemblyId: device.assemblyId,
      label: device.label,
      spellTemplateId: device.spellTemplateId,
      spellName: device.spell?.name ?? compiled.program?.title ?? device.label,
      socketed: true,
      active,
      gateId: device.gateId,
      gateState: gate ?? null,
      gateClosed: closed,
      frame,
      outputIntents,
      lifecycle: runtime.lifecycle,
    });
    for (const intent of outputIntents) {
      if (!intent.physicsField) continue;
      const forceScale = Math.max(0, device.forceScale ?? 1);
      fields.push({
        ...intent.physicsField,
        curtain: intent.physicsField.curtain
          ? {
              ...intent.physicsField.curtain,
              forceMagnitude: intent.physicsField.curtain.forceMagnitude * forceScale,
            }
          : null,
        id: `physics-field:${device.deviceId}:${intent.id}`,
        deviceId: device.deviceId,
        intentId: intent.id,
        materialKind: intent.materialKind ?? null,
        forceMagnitude: intent.physicsField.forceMagnitude * forceScale,
        targetAssemblyId:
          intent.physicsField.fieldShape === 'carrier_levitation'
            ? device.assemblyId
            : intent.physicsField.targetId ?? null,
        excludeAssemblyId:
          intent.physicsField.fieldShape === 'carrier_levitation' ||
          device.targetMask?.excludeOwnerAssembly === false
            ? null
            : device.assemblyId,
      });
    }
  }
  return { fields, devices, runtimes };
}

export function mountedSpellSnapshot(template) {
  if (!template?.compileResult?.program) return null;
  return JSON.parse(JSON.stringify({
    templateId: template.id,
    programId: template.programId ?? template.compileResult.program.programId ?? template.id,
    name: template.name ?? template.compileResult.program.title ?? 'Unnamed spell',
    authorDraft: template.authorDraft ?? null,
    compileResult: template.compileResult,
  }));
}

export function mechanicsNativeSpellTemplates() {
  return MECHANICS_SPELL_TEMPLATES.map((template) => ({
    id: template.templateId,
    programId: compiledTemplate(template.templateId)?.program?.programId ?? template.templateId,
    name: template.label,
    description: template.description,
    source: 'mechanics_native_example',
    compileResult: compiledTemplate(template.templateId),
  }));
}

export function compiledSpellForDevice(device) {
  const native = device?.spell?.compileResult;
  if (native?.program && native?.graph) return native;
  return compiledTemplate(device?.spellTemplateId);
}

export function worldFrameForDevice(device, assemblyTransform) {
  const transform = {
    position: assemblyTransform.position,
    rotation: assemblyTransform.rotation,
  };
  const normal = normalizeVector(transformDirection(transform, device.localFrame.normal));
  let tangent = normalizeVector(transformDirection(transform, device.localFrame.tangent));
  const tangentAlongNormal = normal.x * tangent.x + normal.y * tangent.y + normal.z * tangent.z;
  tangent = normalizeVector({
    x: tangent.x - normal.x * tangentAlongNormal,
    y: tangent.y - normal.y * tangentAlongNormal,
    z: tangent.z - normal.z * tangentAlongNormal,
  });
  const bitangent = normalizeVector(crossVector(normal, tangent));
  const plateScale = Math.max(
    0.05,
    Number(device.plateRadius ?? 0.42) / 0.42,
  );
  return {
    origin: transformPoint(transform, device.localFrame.origin),
    normal,
    tangent,
    bitangent,
    // The physical spell plate is the circle's scale authority. Workbench
    // plate edits and main-world assembly placement both bake their size into
    // plateRadius, so every mounted output follows the same visible owner
    // without multiplying outer and inner assembly scale twice.
    worldScale: 0.55 * plateScale,
    placementMode: 'mounted_surface',
    surfaceMode: 'mechanical_spell_plate',
    surfaceTargetId: device.assemblyId,
    surfaceLabel: device.label,
  };
}

function compiledTemplate(templateId) {
  if (COMPILED_TEMPLATES.has(templateId)) return COMPILED_TEMPLATES.get(templateId);
  const template = MECHANICS_SPELL_TEMPLATES.find((item) => item.templateId === templateId);
  if (!template) return null;
  const compiled = compileSpell(template.fixture);
  COMPILED_TEMPLATES.set(templateId, compiled);
  return compiled;
}

function materialColumnFixture(kind) {
  return {
    title: `${kind[0].toUpperCase()}${kind.slice(1)} Column`,
    seals: [
      {
        sigils: [{ name: kind }],
        rings: [{ radius: 100 }],
        signProfiles: [
          {
            kind: 'column',
            amount: 4,
            size: 200,
            rotation: 0,
            angle: 0,
            radius: 80,
          },
        ],
      },
    ],
  };
}

function windPullFixture() {
  return {
    title: 'Mounted Wind Pull',
    seals: [
      {
        sigils: [{ name: 'wind' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'pull', amount: 2, size: 200, rotation: 45, angle: 45, radius: 80 },
        ],
      },
    ],
  };
}

function windLevitationFixture() {
  return {
    title: 'Mounted Wind Levitation',
    seals: [
      {
        sigils: [{ name: 'wind' }],
        rings: [{ radius: 100 }],
        signProfiles: [
          { kind: 'levitation', amount: 1, radius: 60, angle: 180, size: 280 },
          { kind: 'levitation', amount: 1, radius: 60, angle: 0, size: 140 },
        ],
      },
    ],
  };
}

function mechanicsSceneState(document, snapshot, ownerAssemblyId, baseSceneState = null) {
  return {
    sources: baseSceneState?.sources ?? [],
    props: [
      ...(baseSceneState?.props ?? []),
      ...(document.assemblies ?? [])
      .filter((assembly) => assembly.assemblyId !== ownerAssemblyId)
      .map((assembly) => {
        const runtime = snapshot.assemblies?.[assembly.assemblyId];
        const extent = Math.max(
          0.1,
          ...assembly.parts.map((part) => Math.max(part.size.x, part.size.y, part.size.z)),
        );
        return createSceneProp({
          id: assembly.assemblyId,
          label: assembly.label,
          kind: 'prop',
          visualKind: 'mechanical_assembly',
          targetRole: 'mechanics_pull_target',
          materialFamily: 'generic',
          materialState: 'prop',
          position: runtime?.position ?? assembly.transform.position,
          size: extent,
          mass: runtime?.mass ?? 1,
          cohesion: 1,
          phaseResistance: 1,
          movable: assembly.bodyMode !== 'fixed',
        });
      }),
    ],
  };
}
