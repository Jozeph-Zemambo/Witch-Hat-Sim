export function pointerDirectionFromCenter(clientX, clientY, bounds) {
  const x = clientX - (bounds.left + bounds.width / 2);
  const y = clientY - (bounds.top + bounds.height / 2);
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : null;
}

export function pointerProjection(clientX, clientY, bounds, direction) {
  const x = clientX - (bounds.left + bounds.width / 2);
  const y = clientY - (bounds.top + bounds.height / 2);
  return x * direction.x + y * direction.y;
}
