// Векторы слов с картинок cards/classic. Сайт это не запускает.
// Из папки tools: node build-classic-vectors.mjs
// Нужен запущенный Ollama с моделью bge-m3.
// Слова, которые уже есть в js/vectors.js, копируются оттуда: пространство то же.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CLASSIC_LABELS } from '../js/classic-labels.js';
import { loadVectors } from '../js/vectors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelId = 'bge-m3';
const outPath = path.join(root, 'js', 'classic-vectors.js');

function normWord(word) {
  return String(word || '').toLowerCase().replaceAll('ё', 'е').trim();
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

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

const known = loadVectors();
const dim = known.values().next().value.length;
const words = new Set();
for (const items of Object.values(CLASSIC_LABELS)) {
  for (const item of items) {
    const key = normWord(item.word);
    if (key) words.add(key);
  }
}
const keys = [...words].sort();
const missing = keys.filter((key) => !known.has(key));
console.log('words', keys.length, 'already', keys.length - missing.length, 'new', missing.length, 'dim', dim);

const fresh = new Map();
const BATCH = 32;
for (let start = 0; start < missing.length; start += BATCH) {
  const batch = missing.slice(start, start + BATCH);
  const rows = await embed(batch);
  for (let i = 0; i < batch.length; i++) {
    if (rows[i].length !== dim) throw new Error(`Ширина вектора ${rows[i].length}, ожидалось ${dim}`);
    fresh.set(batch[i], rows[i]);
  }
  console.log(`${Math.min(start + BATCH, missing.length)}/${missing.length}`);
}

const rows = keys.map((key) => known.get(key) || fresh.get(key));
const bytes = new Uint8Array(keys.length * dim * 2);
const view = new DataView(bytes.buffer);
for (let i = 0; i < keys.length; i++) {
  for (let d = 0; d < dim; d++) view.setUint16((i * dim + d) * 2, f32ToF16(rows[i][d]), true);
}

const byKey = new Map(keys.map((key, i) => [key, rows[i]]));
const basket = dot(byKey.get('баскетбол'), byKey.get('корзина'));
const bone = dot(byKey.get('баскетбол'), byKey.get('кость'));
console.log('баскетбол~корзина', basket.toFixed(3), 'баскетбол~кость', bone.toFixed(3));
if (!(basket > bone)) throw new Error('Баскетбол не ближе к корзине, чем к кости');

const body = `// Сгенерировано tools/build-classic-vectors.mjs. Не править руками.
// Слова подписей cards/classic. ${keys.length} слов, ${dim} чисел float16, модель ${modelId}.
// Совпадает с пространством js/vectors.js.

export const DIM = ${dim};

export const KEYS = ${JSON.stringify(keys)};

export const PACKED = ${JSON.stringify(Buffer.from(bytes).toString('base64'))};

export function loadClassicVectors() {
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

fs.writeFileSync(outPath, body);
console.log('wrote', outPath, `${(Buffer.byteLength(body) / 1024 / 1024).toFixed(2)} MB`);
