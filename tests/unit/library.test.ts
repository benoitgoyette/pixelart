import { beforeEach, describe, expect, it } from 'vitest';
import {
  SavedAnimation,
  decodeFrame,
  deleteAnimation,
  encodeFrame,
  findByName,
  listAnimations,
  newAnimationId,
  saveAnimation,
  uniqueName,
} from '../../src/library';

const LIBRARY_KEY = 'pixelart:library';

function entry(name: string, overrides: Partial<SavedAnimation> = {}): SavedAnimation {
  return {
    id: newAnimationId(),
    name,
    width: 2,
    height: 2,
    index: 0,
    frames: [encodeFrame(new Uint8ClampedArray(2 * 2 * 4))],
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());

describe('frame encoding', () => {
  it('round-trips every byte value', () => {
    const data = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    expect(decodeFrame(encodeFrame(data), 256)).toEqual(data);
  });

  it('rejects data of the wrong length rather than returning a short frame', () => {
    const data = new Uint8ClampedArray(64);
    expect(decodeFrame(encodeFrame(data), 128)).toBeNull();
  });

  it('rejects malformed base64', () => {
    expect(decodeFrame('not base64!!', 64)).toBeNull();
  });
});

describe('the library', () => {
  it('starts empty and survives a missing key', () => {
    expect(listAnimations()).toEqual([]);
  });

  it('saves and lists an animation', () => {
    saveAnimation(entry('walk-cycle'));
    expect(listAnimations().map((a) => a.name)).toEqual(['walk-cycle']);
  });

  it('lists newest first', () => {
    saveAnimation(entry('older', { savedAt: 1000 }));
    saveAnimation(entry('newer', { savedAt: 2000 }));
    expect(listAnimations().map((a) => a.name)).toEqual(['newer', 'older']);
  });

  it('replaces by id rather than accumulating duplicates', () => {
    const first = entry('hero');
    saveAnimation(first);
    saveAnimation({ ...first, name: 'hero renamed' });
    const all = listAnimations();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('hero renamed');
  });

  it('keeps entries with different ids side by side', () => {
    saveAnimation(entry('a'));
    saveAnimation(entry('b'));
    expect(listAnimations()).toHaveLength(2);
  });

  it('deletes only the named entry', () => {
    const keep = entry('keep');
    const drop = entry('drop');
    saveAnimation(keep);
    saveAnimation(drop);
    deleteAnimation(drop.id);
    expect(listAnimations().map((a) => a.name)).toEqual(['keep']);
  });

  it('finds by name, ignoring case and surrounding space', () => {
    saveAnimation(entry('Walk Cycle'));
    expect(findByName('walk cycle')?.name).toBe('Walk Cycle');
    expect(findByName('  WALK CYCLE  ')?.name).toBe('Walk Cycle');
    expect(findByName('missing')).toBeUndefined();
  });

  it('suggests an unused name so a save cannot silently collide', () => {
    expect(uniqueName('animation')).toBe('animation');
    saveAnimation(entry('animation'));
    expect(uniqueName('animation')).toBe('animation 2');
    saveAnimation(entry('animation 2'));
    expect(uniqueName('animation')).toBe('animation 3');
  });

  it('survives a corrupt store instead of throwing', () => {
    localStorage.setItem(LIBRARY_KEY, 'not json');
    expect(listAnimations()).toEqual([]);
  });

  it('ignores non-array and malformed entries', () => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ nope: true }));
    expect(listAnimations()).toEqual([]);

    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify([{ id: 'x', name: 'no frames', width: 2, height: 2, frames: [] }, entry('ok')]),
    );
    expect(listAnimations().map((a) => a.name)).toEqual(['ok']);
  });

  it('preserves frame data through a save and reload', () => {
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    pixels.set([255, 0, 0, 255], 0);
    const saved = entry('art', { frames: [encodeFrame(pixels)] });
    saveAnimation(saved);
    const [reloaded] = listAnimations();
    expect(decodeFrame(reloaded.frames[0], 16)).toEqual(pixels);
  });
});
