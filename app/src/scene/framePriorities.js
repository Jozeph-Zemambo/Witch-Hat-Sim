// Shared main-world frame contract. React Three Fiber executes lower priorities
// first; non-positive priorities preserve its automatic render pass.
//
// Held items must attach only after the resolved player pose and camera have
// been published for the current frame. Otherwise they visibly trail by one
// frame, moving backward when the player moves forward and vice versa.
export const MAIN_WORLD_FRAME_PRIORITY = Object.freeze({
  playerInput: -3,
  physics: -2,
  playerPresentation: -1,
  heldItemAttachment: 0,
});
