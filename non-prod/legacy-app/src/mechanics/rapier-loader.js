import RAPIER from '@dimforge/rapier3d-compat';

let rapierPromise = null;

export function loadRapier() {
  if (!rapierPromise) {
    rapierPromise = RAPIER.init()
      .then(() => RAPIER)
      .catch((error) => {
        console.error('Rapier failed to initialize.', error);
        return null;
      });
  }
  return rapierPromise;
}
