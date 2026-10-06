// Реестр колод. Слова — список в своём файле, картинки — папка cards/<набор>/.
// Новая колода подключается одной записью здесь.
// kind: 'image' или 'word'. deal(count, rnd) отдаёт лица карточек для поля.

import { shuffle } from './rng.js';
import { CLASSIC_SET, DECK_COUNT, generatePictures } from './pictures.js';
import { WORDS } from './words.js';
import { WORDS_18 } from './words18.js';

export function dealWords(deck, count, rnd) {
  const unique = [...new Set(deck)];
  if (unique.length < count) {
    throw new Error(`В колоде ${unique.length} слов, а полю нужно ${count}`);
  }
  return shuffle(unique, rnd)
    .slice(0, count)
    .map((text) => ({ kind: 'word', text }));
}

function dealImages(set, deckCount, count, rnd) {
  return generatePictures(count, rnd, deckCount).map((pic) => ({
    kind: 'image',
    set,
    id: pic.id
  }));
}

export const PACKS = {
  classic: {
    id: 'classic',
    kind: 'image',
    title: 'Классические',
    note: 'Классическая колода иллюстраций',
    adult: false,
    deal: (count, rnd) => dealImages(CLASSIC_SET, DECK_COUNT, count, rnd)
  },
  words: {
    id: 'words',
    kind: 'word',
    title: 'Слова',
    note: 'Обычные слова',
    adult: false,
    deal: (count, rnd) => dealWords(WORDS, count, rnd)
  },
  words18: {
    id: 'words18',
    kind: 'word',
    title: 'Слова 18+',
    note: 'Только для взрослых',
    adult: true,
    deal: (count, rnd) => dealWords(WORDS_18, count, rnd)
  }
};

export const PACK_LIST = Object.values(PACKS);

const LEGACY_PACKS = { pictures: 'classic' };

export function resolvePackId(id) {
  if (PACKS[id]) return id;
  if (LEGACY_PACKS[id]) return LEGACY_PACKS[id];
  return null;
}

export function getPack(id) {
  return PACKS[resolvePackId(id)] || PACKS.classic;
}
