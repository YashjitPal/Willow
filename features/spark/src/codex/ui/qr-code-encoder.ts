/**
 * Byte-mode QR Code encoder standing in for the `qrcode` package (`create(value, { errorCorrectionLevel })`), which
 * isn't installed. Returns modules in the same shape (`size` + row-major `data`). The original segments text into
 * numeric/alphanumeric runs, so module patterns can differ while encoding the same value.
 */

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrModules {
  size: number;
  version: number;
  data: boolean[];
}

const LEVEL_INDEX: Record<ErrorCorrectionLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS: Record<ErrorCorrectionLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// prettier-ignore
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number, level: number) {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[level][version] * NUM_ERROR_CORRECTION_BLOCKS[level][version];
}

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]) {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function addEccAndInterleave(data: number[], version: number, level: number) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[level][version];
  const blockEccLength = ECC_CODEWORDS_PER_BLOCK[level][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const block = data.slice(k, k + shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1));
    k += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

const bit = (value: number, index: number) => ((value >>> index) & 1) !== 0;

class Matrix {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function alignmentPositions(version: number, size: number) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < numAlign; position -= step) result.splice(1, 0, position);
  return result;
}

function drawFormatBits(matrix: Matrix, level: ErrorCorrectionLevel, mask: number) {
  const { size } = matrix;
  const data = (FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  for (let i = 0; i <= 5; i++) matrix.setFunction(8, i, bit(bits, i));
  matrix.setFunction(8, 7, bit(bits, 6));
  matrix.setFunction(8, 8, bit(bits, 7));
  matrix.setFunction(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) matrix.setFunction(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) matrix.setFunction(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) matrix.setFunction(8, size - 15 + i, bit(bits, i));
  matrix.setFunction(8, size - 8, true);
}

function drawFunctionPatterns(matrix: Matrix, version: number, level: ErrorCorrectionLevel) {
  const { size } = matrix;
  for (let i = 0; i < size; i++) {
    matrix.setFunction(6, i, i % 2 === 0);
    matrix.setFunction(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) matrix.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((cx, i) => {
    positions.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) matrix.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  drawFormatBits(matrix, level, 0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix.setFunction(a, b, bit(bits, i));
      matrix.setFunction(b, a, bit(bits, i));
    }
  }
}

function drawCodewords(matrix: Matrix, codewords: number[]) {
  const { size } = matrix;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!matrix.isFunction[y][x] && i < codewords.length * 8) {
          matrix.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function applyMask(matrix: Matrix, mask: number) {
  const { size } = matrix;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let invert: boolean;
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0;
          break;
        case 1:
          invert = y % 2 === 0;
          break;
        case 2:
          invert = x % 3 === 0;
          break;
        case 3:
          invert = (x + y) % 3 === 0;
          break;
        case 4:
          invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
          break;
        case 5:
          invert = ((x * y) % 2) + ((x * y) % 3) === 0;
          break;
        case 6:
          invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
        default:
          invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!matrix.isFunction[y][x] && invert) matrix.modules[y][x] = !matrix.modules[y][x];
    }
  }
}

function penaltyScore(matrix: Matrix) {
  const { size, modules } = matrix;
  let result = 0;
  const addHistory = (runLength: number, history: number[]) => {
    if (history[0] === 0) runLength += size;
    history.pop();
    history.unshift(runLength);
  };
  const countPatterns = (history: number[]) => {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  };
  const terminate = (runColor: boolean, runLength: number, history: number[]) => {
    if (runColor) {
      addHistory(runLength, history);
      runLength = 0;
    }
    addHistory(runLength + size, history);
    return countPatterns(history);
  };
  for (const vertical of [false, true]) {
    for (let a = 0; a < size; a++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const dark = vertical ? modules[b][a] : modules[a][b];
        if (dark === runColor) {
          runLength++;
          if (runLength === 5) result += 3;
          else if (runLength > 5) result++;
        } else {
          addHistory(runLength, history);
          if (!runColor) result += countPatterns(history) * 40;
          runColor = dark;
          runLength = 1;
        }
      }
      result += terminate(runColor, runLength, history) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const dark = modules[y][x];
      if (dark === modules[y][x + 1] && dark === modules[y + 1][x] && dark === modules[y + 1][x + 1]) result += 3;
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

export function createQrModules(value: string, options: { errorCorrectionLevel: ErrorCorrectionLevel; version?: number }): QrModules {
  const level = LEVEL_INDEX[options.errorCorrectionLevel];
  const bytes = Array.from(new TextEncoder().encode(value));
  let version = options.version ?? 1;
  for (; ; version++) {
    if (version > 40) throw new RangeError("Data too long for a QR Code");
    const bitLength = 4 + (version <= 9 ? 8 : 16) + bytes.length * 8;
    if (bitLength <= dataCodewords(version, level) * 8) break;
    if (options.version != null) throw new RangeError("Data too long for the requested QR Code version");
  }

  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  const capacity = dataCodewords(version, level) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, b) => (byte << 1) | b, 0));

  const size = version * 4 + 17;
  const matrix = new Matrix(size);
  drawFunctionPatterns(matrix, version, options.errorCorrectionLevel);
  drawCodewords(matrix, addEccAndInterleave(data, version, level));

  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(matrix, mask);
    drawFormatBits(matrix, options.errorCorrectionLevel, mask);
    const penalty = penaltyScore(matrix);
    if (penalty < bestPenalty) {
      bestMask = mask;
      bestPenalty = penalty;
    }
    applyMask(matrix, mask);
  }
  applyMask(matrix, bestMask);
  drawFormatBits(matrix, options.errorCorrectionLevel, bestMask);

  return { size, version, data: matrix.modules.flat() };
}
