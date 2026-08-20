let rapierPromise = null;

export function loadRapier() {
  if (!rapierPromise) {
    // The compat package embeds its WASM as base64 and is one of the largest
    // modules in the app. Load and initialize it only when a physics surface
    // mounts so title/dev UI and the WebGL canvas can commit first.
    rapierPromise = import('@dimforge/rapier3d-compat')
      .then(async (module) => {
        const RAPIER = module.default ?? module;
        await RAPIER.init();
        return RAPIER;
      })
      .catch((error) => {
        console.error('Rapier failed to initialize.', error);
        return null;
      });
  }
  return rapierPromise;
}
