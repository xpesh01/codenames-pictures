// Подписи cards/classic через зрительную модель. Сайт это не запускает.
// Модель: локальный ярлык codenames-vl (qwen3-vl:8b без шага размышления).
// Собрать ярлык: ollama create codenames-vl -f Modelfile.vl
// Из папки tools: node label-classic.mjs
// Уже подписанные файлы не трогает. Новые webp в cards/classic подписывает.
// Ключ в js/classic-labels.js — имя файла, например 000.webp.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CLASSIC_LABELS } from '../js/classic-labels.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cardsDir = path.join(root, 'cards', 'classic');
const outPath = path.join(root, 'js', 'classic-labels.js');
const objectModel = 'codenames-vl';

const objectPrompt = [
  'Это карточка игры «Кодовые имена»: одна картинка-загадка.',
  'Назови объекты, которые на ней нарисованы.',
  'Каждому слову дай вес от 0.15 до 1: чем объект крупнее и чем сильнее картинка про него, тем вес выше.',
  'Каждое word — ровно одно существительное, без прилагательного и без пробела.',
  'От 3 до 8 слов. Не описывай фон, рамку и стиль рисунка.',
  'Ответ только JSON: {"items":[{"word":"кольцо","weight":1}]}'
].join('\n');

function assocPrompt(have) {
  return [
    'Это карточка игры «Кодовые имена».',
    'В поле think коротко реши, что это за картинка.',
    'В items дай слова-ассоциации: их нет среди нарисованных предметов, но по ним карточку узнают.',
    'Пример: кольцо с сеткой — слово «баскетбол».',
    have.length ? `Уже есть, не повторяй: ${have.join(', ')}.` : '',
    'Каждое word — ровно одно существительное, без пробела.',
    'Вес от 0.15 до 1: насколько слово связано с картинкой. Самое точное слово — с весом 1.',
    'От 4 до 8 слов.',
    'Ответ только JSON: {"think":"кольцо для баскетбола","items":[{"word":"баскетбол","weight":1}]}'
  ].filter(Boolean).join('\n');
}

function parseItems(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('нет JSON');
  const data = JSON.parse(text.slice(start, end + 1));
  const raw = Array.isArray(data) ? data : data.items || data.words || data.objects;
  if (!Array.isArray(raw)) throw new Error('нет списка');
  const seen = new Set();
  const items = [];
  for (const row of raw) {
    const rawWord = String(row.word || row.name || '').toLowerCase().replaceAll('ё', 'е');
    const tokens = rawWord.split(/[^а-я-]+/).filter((token) => token.length >= 3 && token.length <= 14);
    const word = tokens[tokens.length - 1] || '';
    if (/(ый|ий|ой|ая|яя|ое|ые)$/.test(word)) continue;
    if (['нельзя', 'можно', 'надо', 'это', 'очень', 'просто', 'только', 'когда', 'если'].includes(word)) continue;
    let weight = Number(row.weight);
    if (!word || word.length < 2 || seen.has(word) || !Number.isFinite(weight)) continue;
    weight = Math.round(Math.min(1, Math.max(0.15, weight)) * 100) / 100;
    seen.add(word);
    items.push({ word, weight });
  }
  items.sort((a, b) => b.weight - a.weight);
  if (items.length < 1) throw new Error('мало слов');
  return items.slice(0, 8);
}

function asMap(raw) {
  if (Array.isArray(raw)) {
    const map = {};
    raw.forEach((items, id) => {
      if (Array.isArray(items) && items.length) map[`${String(id).padStart(3, '0')}.webp`] = items;
    });
    return map;
  }
  return raw && typeof raw === 'object' ? { ...raw } : {};
}

function sorted(labels) {
  return Object.fromEntries(Object.keys(labels).sort().map((name) => [name, labels[name]]));
}

function writeModule(labels) {
  const body = `// Подписи карточек cards/classic. Сгенерировано tools/label-classic.mjs.
// Ключ — имя файла. weight — насколько слово главное (0.15–1).
// assoc: true — ассоциация, а не предмет на рисунке.

export const CLASSIC_LABELS = ${JSON.stringify(sorted(labels), null, 2)};
`;
  fs.writeFileSync(outPath, body);
}

function cardFiles() {
  return fs.readdirSync(cardsDir).filter((name) => name.endsWith('.webp')).sort();
}

async function ask(name, content, think) {
  const image = fs.readFileSync(path.join(cardsDir, name)).toString('base64');
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: objectModel,
      think: false,
      stream: false,
      format: 'json',
      keep_alive: '30m',
      messages: [{ role: 'user', content, images: [image] }],
      options: { temperature: 0, num_predict: 400 }
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const text = [data.message?.content, data.message?.thinking].filter(Boolean).join('\n');
  try {
    return { items: parseItems(text), sec: (data.total_duration || 0) / 1e9 };
  } catch (err) {
    const tail = text.replace(/\s+/g, ' ').slice(-500);
    throw new Error(`${err.message}; content ${String(data.message?.content || '').length}; thinking ${String(data.message?.thinking || '').length}; ${tail}`);
  }
}

const labels = asMap(CLASSIC_LABELS);
const files = new Set(cardFiles());
for (const name of Object.keys(labels)) {
  if (!files.has(name)) delete labels[name];
}

function needsObjects(name) {
  return !labels[name]?.length;
}

function needsAssoc(name) {
  return !(labels[name] || []).some((item) => item.assoc);
}

const only = process.argv[2] === '--only' ? process.argv[3] : null;
const names = only ? [only] : cardFiles();
const pending = names.filter((name) => needsObjects(name) || needsAssoc(name));
console.log('pending', pending.length);

for (const name of pending) {
  if (needsObjects(name)) {
    let items = null;
    let sec = 0;
    for (let attempt = 0; attempt < 2 && !items; attempt++) {
      try {
        const row = await ask(name, objectPrompt, false);
        items = row.items;
        sec = row.sec;
      } catch (_) {}
    }
    if (!items) {
      console.log(`FAIL objects ${name}`);
      continue;
    }
    labels[name] = items;
    writeModule(labels);
    console.log(`${name} objects ${sec.toFixed(1)}s ${items.map((item) => item.word).join(' ')}`);
  }

  if (!needsAssoc(name)) continue;
  const have = (labels[name] || []).map((item) => item.word);
  let extra = null;
  let sec = 0;
  let lastErr = null;
  for (let attempt = 0; attempt < 2 && !extra; attempt++) {
    try {
      const row = await ask(name, assocPrompt(have), true);
      extra = row.items.filter((item) => !have.includes(item.word)).map((item) => ({ ...item, assoc: true }));
      sec = row.sec;
      if (!extra.length) throw new Error('нет новых слов');
    } catch (err) {
      lastErr = err;
      extra = null;
    }
  }
  if (!extra) {
    console.log(`FAIL assoc ${name} ${lastErr?.message || lastErr}`);
    continue;
  }
  labels[name] = [...(labels[name] || []), ...extra];
  writeModule(labels);
  console.log(`${name} assoc ${sec.toFixed(1)}s ${extra.map((item) => `${item.word}:${item.weight}`).join(' ')}`);
}

writeModule(labels);
console.log('wrote', outPath, Object.keys(labels).length);
