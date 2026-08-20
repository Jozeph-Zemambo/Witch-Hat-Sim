// Background music manager for The Wandering Atelier.
// Streams royalty-free tracks by Kevin MacLeod (incompetech.com), CC BY 4.0.
// Playback only ever starts after a user gesture (autoplay-policy safe) and
// all network/decode failures are swallowed silently.

export const MUSIC_TRACKS = [
  {
    title: 'Peaceful Desolation',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Peaceful%20Desolation.mp3',
  },
  {
    title: 'Frost Waltz',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Frost%20Waltz.mp3',
  },
  {
    title: 'Fairytale Waltz',
    url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Fairytale%20Waltz.mp3',
  },
];

export const MUSIC_ATTRIBUTION =
  'Music: "Peaceful Desolation", "Frost Waltz", "Fairytale Waltz" — Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0.';

const STORAGE_KEY = 'wha-music-enabled';
const VOLUME_STORAGE_KEY = 'wha-music-volume';
const DEFAULT_VOLUME = 0.35;

let audio = null;
let order = [];
let orderIndex = 0;
let consecutiveFailures = 0;
let enabled = readStoredPreference();
let volume = readStoredVolume();
const listeners = new Set();

function readStoredPreference() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === '1';
  } catch {
    return true;
  }
}

function persistPreference(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

function readStoredVolume() {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const stored = Number(raw);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1
      ? stored
      : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function persistVolume(value) {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

function shuffledTrackOrder() {
  const indices = MUSIC_TRACKS.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = volume;
  audio.addEventListener('ended', () => {
    consecutiveFailures = 0;
    advanceTrack();
  });
  audio.addEventListener('error', () => {
    // Graceful fallback: skip broken tracks, stop quietly if all of them fail.
    consecutiveFailures += 1;
    if (enabled && consecutiveFailures < MUSIC_TRACKS.length) advanceTrack();
  });
  return audio;
}

function currentTrack() {
  if (order.length === 0) order = shuffledTrackOrder();
  return MUSIC_TRACKS[order[orderIndex % order.length]];
}

function advanceTrack() {
  if (order.length === 0) order = shuffledTrackOrder();
  orderIndex = (orderIndex + 1) % order.length;
  if (orderIndex === 0) order = shuffledTrackOrder();
  playCurrent();
}

function playCurrent() {
  if (!enabled) return;
  const element = ensureAudio();
  const track = currentTrack();
  if (!track) return;
  if (element.src !== track.url) element.src = track.url;
  const attempt = element.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch(() => {
      // Autoplay rejection or network hiccup — stay silent, toggle still works.
    });
  }
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(enabled);
    } catch {
      // Listener errors should never break playback.
    }
  });
}

export function isMusicEnabled() {
  return enabled;
}

export function setMusicEnabled(value) {
  enabled = Boolean(value);
  persistPreference(enabled);
  if (enabled) {
    consecutiveFailures = 0;
    playCurrent();
  } else if (audio) {
    audio.pause();
  }
  notify();
}

export function toggleMusic() {
  setMusicEnabled(!enabled);
  return enabled;
}

export function getMusicVolume() {
  return volume;
}

export function setMusicVolume(value) {
  const next = Math.min(1, Math.max(0, Number(value)));
  if (!Number.isFinite(next)) return volume;
  volume = next;
  persistVolume(volume);
  if (audio) audio.volume = volume;
  return volume;
}

// Call from a user-gesture handler (e.g. the title-screen Play click) so
// playback satisfies browser autoplay policies.
export function startMusicIfEnabled() {
  if (enabled) {
    consecutiveFailures = 0;
    playCurrent();
  }
}

export function subscribeToMusic(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Debug handle (mirrors the __WHA_PLAYER__ convention used elsewhere).
if (typeof window !== 'undefined') {
  window.__WHA_MUSIC__ = {
    get audio() {
      return audio;
    },
    get enabled() {
      return enabled;
    },
    get volume() {
      return volume;
    },
  };
}
