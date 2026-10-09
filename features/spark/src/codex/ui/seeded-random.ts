const WIDTH = 256;
const MASK = WIDTH - 1;
const START_DENOM = WIDTH ** 6;
const SIGNIFICANCE = 2 ** 52;
const OVERFLOW = SIGNIFICANCE * 2;

/** ARC4 keystream with the first 256 bytes dropped, as in `seedrandom`. */
function arc4(key: number[]) {
  const keyLength = key.length || 1;
  const state = Array.from({ length: WIDTH }, (_, index) => index);
  let i = 0;
  let j = 0;
  for (let index = 0, swap = 0; index < WIDTH; index++) {
    swap = state[index];
    j = MASK & (j + (key[index % keyLength] ?? 0) + swap);
    state[index] = state[j];
    state[j] = swap;
  }
  j = 0;
  const next = (count: number) => {
    let result = 0;
    while (count--) {
      i = MASK & (i + 1);
      const swap = state[i];
      j = MASK & (j + swap);
      state[i] = state[j];
      state[j] = swap;
      result = result * WIDTH + state[MASK & (state[i] + state[j])];
    }
    return result;
  };
  next(WIDTH);
  return next;
}

/** Deterministic `[0, 1)` generator matching `seedrandom(seed)` for string seeds (`bIt.default` in the bundles). */
export function seededRandom(seed: string): () => number {
  const key: number[] = [];
  let smear = 0;
  for (let index = 0; index < seed.length; ) {
    smear ^= (key[MASK & index] ?? 0) * 19;
    key[MASK & index] = MASK & (smear + seed.charCodeAt(index++));
  }
  const next = arc4(key);
  return () => {
    let n = next(6);
    let d = START_DENOM;
    let x = 0;
    while (n < SIGNIFICANCE) {
      n = (n + x) * WIDTH;
      d *= WIDTH;
      x = next(1);
    }
    while (n >= OVERFLOW) {
      n /= 2;
      d /= 2;
      x >>>= 1;
    }
    return (n + x) / d;
  };
}
