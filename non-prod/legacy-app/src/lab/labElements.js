// Shared element definitions for the Column and Dispersion labs.
import { LIGHT_MAGIC } from '../visual/lightMagic.js';
//
// Water keeps its bespoke, physically-arcing column / falling-curtain dispersion.
// The other elements are simpler by design (per the visual direction): straight
// columns and mostly-flat dispersions. Only earth reacts to gravity, and only on
// deactivation, where it crumbles apart (no residuals need to remain). Fire and
// light additionally cast real light into the scene — light much larger/stronger.

export const ELEMENTS = [
  { id: 'water', label: 'Water' },
  { id: 'fire', label: 'Fire' },
  { id: 'earth', label: 'Earth' },
  { id: 'light', label: 'Light' },
  { id: 'wind', label: 'Wind' },
];

export function elementById(id) {
  return ELEMENTS.find((element) => element.id === id) ?? ELEMENTS[0];
}

// Visual config for the non-water straight column / flat dispersion.
export const ELEMENT_VISUALS = {
  fire: {
    color: '#ff6a1f',
    accent: '#ffd27a',
    emissive: '#ff3300',
    emissiveIntensity: 1.5,
    opacity: 0.92,
    wobble: 0.1,
    flicker: true,
    light: { color: '#ff7e33', intensity: 2.4, distance: 10 },
  },
  earth: {
    color: '#9c6b3f',
    accent: '#caa37a',
    emissive: '#140c06',
    emissiveIntensity: 0,
    opacity: 1,
    wobble: 0.02,
    flatShading: true,
    gravityOnDeactivate: true,
  },
  light: {
    color: LIGHT_MAGIC.body,
    accent: LIGHT_MAGIC.highlight,
    emissive: LIGHT_MAGIC.emissive,
    emissiveIntensity: 2.6,
    opacity: 0.85,
    wobble: 0.05,
    // Much larger, stronger illumination than fire.
    light: { color: LIGHT_MAGIC.illumination, intensity: 5.5, distance: 28 },
  },
  wind: {
    // Near-transparent body with light-gray streaks running through it — air you
    // can barely see, not smoke. The streak colors are read by the scenes.
    color: '#eef4f2',
    accent: '#f7fbfa',
    emissive: '#ffffff',
    emissiveIntensity: 0.05,
    opacity: 0.13,
    wobble: 0.14,
    streaks: {
      bright: '#dfe8e5', // light gray streaks
      faint: '#f6faf9', // almost fully see-through streaks
      brightOpacity: 0.6,
      faintOpacity: 0.22,
    },
  },
};

export function elementVisual(id) {
  return ELEMENT_VISUALS[id] ?? ELEMENT_VISUALS.fire;
}

// Fire and light dim the lab and show their own glow; the others keep the bright
// neutral practice-field lighting.
export function sceneLighting(elementId) {
  if (elementId === 'fire') {
    return {
      background: '#140d0a',
      ambientColor: '#3a221a',
      ambientIntensity: 0.22,
      dirIntensity: 0.3,
      groundColor: '#2a2018',
    };
  }
  if (elementId === 'light') {
    return {
      background: '#0c0e16',
      ambientColor: '#1c2030',
      ambientIntensity: 0.2,
      dirIntensity: 0.28,
      groundColor: '#1c2030',
    };
  }
  return {
    background: '#f6fbfd',
    ambientColor: '#effff8',
    ambientIntensity: 0.86,
    dirIntensity: 0.72,
    groundColor: '#edf5ef',
  };
}
