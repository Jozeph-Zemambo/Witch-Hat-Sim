import watershotCentered from '../../../test/fixtures/watershot-centered.json';
import waterHeater from '../../../test/fixtures/spellmaker-water-heater.json';
import gatherMultiDomain from '../../../test/fixtures/gather-multi-domain.json';
import convergencePointFocus from '../../../test/fixtures/convergence-point-focus-valid.json';
import pullAngledTwist from '../../../test/fixtures/pull-angled-twist.json';
import radialWater from '../../../test/fixtures/radial-water.json';
import radialEarth from '../../../test/fixtures/radial-earth.json';
import radialLight from '../../../test/fixtures/radial-light.json';
import mudWaterEarthMixture from '../../../test/fixtures/mud-water-earth-mixture.json';
import gatherCoolMistReversion from '../../../test/fixtures/gather-cool-mist-reversion.json';

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
    id: 'wind-pull',
    label: 'Wind Pull',
    description: 'Pull targets a movable practice prop and previews physics motion.',
    fixture: pullAngledTwist,
  },
  {
    id: 'convergence-focus',
    label: 'Convergence Focus',
    description: 'Convergence exposes runtime compression metadata and debug axes.',
    fixture: convergencePointFocus,
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
