import watershotCentered from '../../test/fixtures/watershot-centered.json' with { type: 'json' };
import waterHeater from '../../test/fixtures/spellmaker-water-heater.json' with { type: 'json' };
import gatherMultiDomain from '../../test/fixtures/gather-multi-domain.json' with { type: 'json' };
import collectionMultiDomain from '../../test/fixtures/collection-multi-domain.json' with { type: 'json' };
import convergencePointFocus from '../../test/fixtures/convergence-point-focus-valid.json' with { type: 'json' };
import pullAngledTwist from '../../test/fixtures/pull-angled-twist.json' with { type: 'json' };
import radialWater from '../../test/fixtures/radial-water.json' with { type: 'json' };
import radialEarth from '../../test/fixtures/radial-earth.json' with { type: 'json' };
import radialLight from '../../test/fixtures/radial-light.json' with { type: 'json' };
import mudWaterEarthMixture from '../../test/fixtures/mud-water-earth-mixture.json' with { type: 'json' };
import gatherCoolMistReversion from '../../test/fixtures/gather-cool-mist-reversion.json' with { type: 'json' };
import outwardColumnWater from '../../test/fixtures/outward-column-water.json' with { type: 'json' };
import levitationFireBalanced from '../../test/fixtures/levitation-fire-balanced.json' with { type: 'json' };
import levitationFireLaunch from '../../test/fixtures/levitation-fire-launch.json' with { type: 'json' };
import levitationWindStream from '../../test/fixtures/levitation-wind-stream.json' with { type: 'json' };

export const SAMPLE_SPELLS = [
  {
    id: 'watershot-centered',
    label: 'Watershot Centered',
    description: 'Water + balanced column signs, rendered as a metadata-driven beam.',
    fixture: watershotCentered,
  },
  {
    id: 'water-heater',
    label: 'Water Heater',
    description: 'Crosshair applies radial fire heat to center water material state.',
    fixture: waterHeater,
  },
  {
    id: 'region-watershot',
    label: 'Region Watershot',
    description: 'Region signs split one water-column budget across emergence anchors.',
    fixture: regionWatershotFixture(watershotCentered),
  },
  {
    id: 'water-dispersion',
    label: 'Water Dispersion',
    description: 'Outward column geometry emits a finite water spray instead of disappearing.',
    fixture: outwardColumnWater,
  },
  {
    id: 'mist-cloud',
    label: 'Mist Cloud',
    description: 'Weak radial water renders as in-world mist instead of a silent water source.',
    fixture: radialWater,
  },
  {
    id: 'crushed-earth',
    label: 'Crushed Earth',
    description: 'Weak radial earth renders crushed earth and dust around the spell frame.',
    fixture: radialEarth,
  },
  {
    id: 'light-glow',
    label: 'Light Glow',
    description: 'Weak radial light renders a glow state without heat or force.',
    fixture: radialLight,
  },
  {
    id: 'glow-watershot',
    label: 'Glow Watershot',
    description: 'Radial light attaches glow to an active generated water column.',
    fixture: glowWatershotFixture(),
  },
  {
    id: 'mud-mix',
    label: 'Mud Mix',
    description: 'Liquid water from a scene source mixes with crushed earth into sludge.',
    fixture: mudWaterEarthMixture,
  },
  {
    id: 'gather-cool-mist',
    label: 'Gather Cool Mist',
    description: 'Gathered mist/cloud condenses back into water when cooled.',
    fixture: gatherCoolMistReversion,
  },
  {
    id: 'earth-pillar',
    label: 'Earth Pillar',
    description: 'Earth + column renders as a generated solid pillar.',
    fixture: materialColumnFixture('earth'),
  },
  {
    id: 'light-beam',
    label: 'Light Beam',
    description: 'Light + column renders as illumination without heat or force.',
    fixture: materialColumnFixture('light'),
  },
  {
    id: 'wind-beam',
    label: 'Wind Beam',
    description: 'Wind + column renders as airflow; object motion waits for physics.',
    fixture: materialColumnFixture('wind'),
  },
  {
    id: 'gather-water',
    label: 'Gather Water',
    description: 'Gather exposes source reach, candidate checks, and source handoff debug.',
    fixture: gatherMultiDomain,
  },
  {
    id: 'collection-nearby',
    label: 'Collection Nearby',
    description: 'Collection queries nearby movable material without feeding generation.',
    fixture: collectionMultiDomain,
  },
  {
    id: 'wind-pull',
    label: 'Wind Pull',
    description: 'Pull targets a movable practice prop and previews physics motion.',
    fixture: pullAngledTwist,
  },
  {
    id: 'fire-levitation',
    label: 'Fire Levitation',
    description: 'Balanced levitation generates a hovering fire orb.',
    fixture: levitationFireBalanced,
  },
  {
    id: 'water-levitation',
    label: 'Water Levitation',
    description: 'Balanced levitation generates a hovering liquid-water orb.',
    fixture: levitationDomainFixture(levitationFireBalanced, 'water'),
  },
  {
    id: 'earth-levitation',
    label: 'Earth Levitation',
    description: 'Balanced levitation generates a hovering faceted earth mass.',
    fixture: levitationDomainFixture(levitationFireBalanced, 'earth'),
  },
  {
    id: 'light-levitation',
    label: 'Light Levitation',
    description: 'Balanced levitation generates a hovering golden-light orb.',
    fixture: levitationDomainFixture(levitationFireBalanced, 'light'),
  },
  {
    id: 'fire-levitation-launch',
    label: 'Fire Levitation Launch',
    description: 'Imbalanced levitation launches a generated fire orb along the resolved sign vector.',
    fixture: levitationFireLaunch,
  },
  {
    id: 'wind-levitation',
    label: 'Wind Levitation',
    description: 'Imbalanced levitation renders a directional stream with force deferred to physics.',
    fixture: levitationWindStream,
  },
  {
    id: 'convergence-focus',
    label: 'Convergence Focus',
    description: 'Convergence compresses an active water column and exposes debug axes.',
    fixture: convergedColumnFixture(convergencePointFocus),
  },
];

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function levitationDomainFixture(source, kind) {
  const fixture = JSON.parse(JSON.stringify(source));
  fixture.title = `${kind[0].toUpperCase()}${kind.slice(1)} Levitation`;
  fixture.seals[0].sigils = [{ name: kind }];
  return fixture;
}

function glowWatershotFixture() {
  return {
    title: 'Glow Watershot',
    seals: [
      {
        sigils: [{ name: 'water' }],
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
      {
        sigils: [{ name: 'light' }],
        rings: [{ radius: 80 }],
        signProfiles: [{ kind: 'radial', amount: 2, radius: 40, angle: 0 }],
      },
    ],
  };
}

function convergedColumnFixture(baseFixture) {
  const fixture = structuredClone(baseFixture);
  fixture.title = 'Converged Water Column';
  fixture.seals[0].signProfiles = [
    {
      kind: 'column',
      amount: 4,
      size: 200,
      rotation: 0,
      angle: 0,
      radius: 80,
    },
    ...fixture.seals[0].signProfiles,
  ];
  return fixture;
}

function regionWatershotFixture(baseFixture) {
  const fixture = structuredClone(baseFixture);
  fixture.title = 'Region Watershot';
  fixture.seals[0].signProfiles.push({
    kind: 'region',
    amount: 2,
    size: 200,
    rotation: 0,
    angle: 180,
    radius: 120,
  });
  return fixture;
}
