/*
 * pixelart — a browser-based pixel art editor
 * Copyright (C) 2026 Benoit Goyette
 *
 * Free software under the GNU General Public License v3 or later, without any
 * warranty. See the LICENSE file at the root of this repository.
 */

/**
 * Named animations kept in localStorage, separate from the autosaved working
 * state. Frames are stored base64-encoded so the whole library is one JSON blob.
 */

const LIBRARY_KEY = 'pixelart:library';

export interface SavedAnimation {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Frame selected when it was saved. */
  index: number;
  frames: string[];
  savedAt: number;
}

export function encodeFrame(data: Uint8ClampedArray): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeFrame(encoded: string, expectedBytes: number): Uint8ClampedArray | null {
  try {
    const binary = atob(encoded);
    if (binary.length !== expectedBytes) return null;
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Newest first. Malformed entries are skipped rather than failing the list. */
export function listAnimations(): SavedAnimation[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isAnimation)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function isAnimation(value: unknown): value is SavedAnimation {
  const entry = value as Partial<SavedAnimation>;
  return (
    typeof entry?.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.width === 'number' &&
    typeof entry.height === 'number' &&
    Array.isArray(entry.frames) &&
    entry.frames.length > 0
  );
}

export function findByName(name: string): SavedAnimation | undefined {
  const wanted = name.trim().toLowerCase();
  return listAnimations().find((entry) => entry.name.trim().toLowerCase() === wanted);
}

/** Inserts or replaces by id. Throws if the browser's storage quota is exceeded. */
export function saveAnimation(entry: SavedAnimation): void {
  const all = listAnimations().filter((other) => other.id !== entry.id);
  all.push(entry);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(all));
}

export function deleteAnimation(id: string): void {
  const remaining = listAnimations().filter((entry) => entry.id !== id);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(remaining));
}

export function newAnimationId(): string {
  return `a${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "walk-cycle 2" when "walk-cycle" is taken, so saving never silently collides. */
export function uniqueName(base: string): string {
  if (!findByName(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!findByName(candidate)) return candidate;
  }
  return base;
}
