// Одноразовая сборка js/vectors.js. Сайт этот скрипт не запускает.
// Из папки tools: node build-vectors.mjs
// Нужен запущенный Ollama с моделью bge-m3.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelId = 'bge-m3';

function quotedWords(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  return [...src.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

export function normWord(word) {
  return String(word || '').toLowerCase().replaceAll('ё', 'е').trim();
}

function collectKeys() {
  const display = new Map();
  const sources = ['js/words.js', 'js/words18.js', 'js/cluevocab.js'];
  for (const file of sources) {
    for (const word of quotedWords(file)) {
      const key = normWord(word);
      if (key && !display.has(key)) display.set(key, word);
    }
  }
  return [...display.keys()];
}

function f32ToF16(value) {
  const f32 = new Float32Array(1);
  const i32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = i32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 255) return sign | (mant ? 0x7e00 : 0x7c00);
  const halfExp = exp - 127 + 15;
  if (halfExp >= 31) return sign | 0x7c00;
  if (halfExp <= 0) {
    if (halfExp < -10) return sign;
    const merged = mant | 0x800000;
    const shift = 1 - halfExp;
    let halfMant = merged >>> (shift + 13);
    if ((merged >>> (shift + 12)) & 1) halfMant += 1;
    return sign | halfMant;
  }
  let halfMant = mant >>> 13;
  if ((mant >>> 12) & 1) {
    halfMant += 1;
    if (halfMant === 0x400) return sign | ((halfExp + 1) << 10);
  }
  return sign | (halfExp << 10) | halfMant;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function unit(vec) {
  let sum = 0;
  for (const value of vec) sum += value * value;
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  return Float32Array.from(vec, (value) => value * inv);
}

async function embed(batch) {
  const res = await fetch('http://127.0.0.1:11434/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, input: batch, keep_alive: '20m' })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  if (!data.embeddings || data.embeddings.length !== batch.length) {
    throw new Error('Ollama не вернула векторы');
  }
  return data.embeddings.map(unit);
}

const keys = collectKeys();
console.log('words', keys.length);

const probe = await embed(['море']);
const dim = probe[0].length;
console.log('dim', dim, 'model', modelId);

const BATCH = 32;
const rows = new Array(keys.length);
for (let start = 0; start < keys.length; start += BATCH) {
  const batch = keys.slice(start, start + BATCH);
  const embedded = await embed(batch);
  for (let i = 0; i < batch.length; i++) {
    if (embedded[i].length !== dim) throw new Error(`Ширина вектора ${embedded[i].length}, ожидалось ${dim}`);
    rows[start + i] = embedded[i];
  }
  console.log(`${Math.min(start + BATCH, keys.length)}/${keys.length}`);
}

const byKey = new Map(keys.map((key, i) => [key, rows[i]]));
function sim(a, b) {
  return dot(byKey.get(a), byKey.get(b));
}
const seaShip = sim('море', 'корабль');
const seaCheese = sim('море', 'сыр');
console.log('море~корабль', seaShip.toFixed(3), 'море~сыр', seaCheese.toFixed(3));
if (!(seaShip > seaCheese)) {
  throw new Error('Векторы не отличают море/корабль от море/сыр');
}

const bytes = new Uint8Array(keys.length * dim * 2);
const view = new DataView(bytes.buffer);
for (let i = 0; i < keys.length; i++) {
  for (let d = 0; d < dim; d++) {
    view.setUint16((i * dim + d) * 2, f32ToF16(rows[i][d]), true);
  }
}

const packed = Buffer.from(bytes).toString('base64');
const body = `// Сгенерировано tools/build-vectors.mjs. Не править руками.
// ${keys.length} слов, ${dim} чисел float16, модель ${modelId}.

export const DIM = ${dim};

export const KEYS = ${JSON.stringify(keys)};

export const PACKED = ${JSON.stringify(packed)};

export function loadVectors() {
  const binary = Uint8Array.from(atob(PACKED), (c) => c.charCodeAt(0));
  const view = new DataView(binary.buffer);
  const map = new Map();
  for (let i = 0; i < KEYS.length; i++) {
    const vec = new Float32Array(DIM);
    let sum = 0;
    for (let d = 0; d < DIM; d++) {
      const value = view.getFloat16((i * DIM + d) * 2, true);
      vec[d] = value;
      sum += value * value;
    }
    const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let d = 0; d < DIM; d++) vec[d] *= inv;
    map.set(KEYS[i], vec);
  }
  return map;
}
`;

const outPath = path.join(root, 'js', 'vectors.js');
fs.writeFileSync(outPath, body);
console.log('wrote', outPath, `${(Buffer.byteLength(body) / 1024 / 1024).toFixed(2)} MB`);
