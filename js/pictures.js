// Процедурные «картинки» для карточек.
// Вместо готовых иллюстраций собираем сюрреалистичные эмодзи-коллажи:
// фон-градиент + геометрический узор + 2-3 эмодзи в разных позах.
// Плюс: ничего не грузится из сети, нет вопросов с лицензиями,
// и комбинаций хватает, чтобы партии не повторялись.

import { pick, shuffle } from './rng.js';

const EMOJI = [
  '🐙','🦑','🦈','🐳','🐊','🦎','🐍','🦂','🕷️','🦋','🐌','🐝','🦗','🦀','🐡','🦩',
  '🦚','🦉','🦇','🐘','🦏','🦒','🦓','🐫','🦌','🐻','🦝','🦔','🐿️','🐸','🐷','🐓',
  '🌵','🌴','🍄','🌻','🌲','🍁','🪵','🌾','🪸','🐚','🪨','🌋','🏔️','🏝️','🌊','❄️',
  '🔥','⚡','🌪️','🌈','☄️','🪐','🌙','⭐','🌞','☁️','💧','🫧',
  '🍕','🍔','🌮','🍣','🍩','🍦','🥨','🧀','🥑','🍉','🍍','🌶️','🥕','🍳','🍿','🧁',
  '🚀','🛸','🚁','⛵','🚂','🏍️','🛺','🚜','🛼','🪂','🎈','🪁','⚓','🧭','🗿','🏰',
  '🎸','🥁','🎺','🎻','🪗','🎹','🎤','📻','🎬','📷','🔭','🔬','📡','💡','🕯️','🪩',
  '⌛','⏰','🔑','🔒','🗝️','💎','👑','🎩','🕶️','🧦','👢','🧤','👜','☂️','🪜','🧲',
  '🧪','💉','🩻','🦴','🧠','👁️','🦷','🫀','🤖','👻','👽','🧟','🧜','🧙','🦸','🤡',
  '🎯','🎲','♟️','🧩','🪀','🎳','🏀','🏓','🥊','🪃','🛹','⛸️','🎿','🪝','🪓','🔨',
  '📚','✏️','📌','🧷','📎','🪞','🛋️','🚪','🪑','🛁','🧻','🧹','🪠','🕳️','🪦','⚰️'
];

const PALETTES = [
  ['#ff9a9e', '#fad0c4'], ['#a18cd1', '#fbc2eb'], ['#f6d365', '#fda085'],
  ['#84fab0', '#8fd3f4'], ['#ffecd2', '#fcb69f'], ['#ff8177', '#b12a5b'],
  ['#5ee7df', '#b490ca'], ['#30cfd0', '#330867'], ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30a0e0', '#1e3c72'],
  ['#c79081', '#dfa579'], ['#8ec5fc', '#e0c3fc'], ['#d9afd9', '#97d9e1'],
  ['#f79d00', '#64f38c'], ['#ee9ca7', '#ffdde1'], ['#2af598', '#009efd'],
  ['#e8198b', '#c7eafd'], ['#f093fb', '#f5576c'], ['#0ba360', '#3cba92'],
  ['#ffd26f', '#3677ff'], ['#b721ff', '#21d4fd'], ['#6a11cb', '#2575fc']
];

const PATTERNS = ['dots', 'rays', 'rings', 'grid', 'waves', 'none'];

const LAYOUTS = ['center', 'duo', 'stack', 'corner', 'orbit'];

/**
 * Генерирует набор уникальных «картинок» для поля.
 * @param {number} count сколько карточек
 * @param {() => number} rnd детерминированный rng
 */
export function generatePictures(count, rnd) {
  const mains = shuffle(EMOJI, rnd).slice(0, count);
  const extras = shuffle(EMOJI, rnd);
  let cursor = 0;
  const nextExtra = (exclude) => {
    for (let i = 0; i < extras.length; i++) {
      const e = extras[(cursor + i) % extras.length];
      if (!exclude.includes(e)) {
        cursor = (cursor + i + 1) % extras.length;
        return e;
      }
    }
    return extras[0];
  };

  return mains.map((main) => {
    const side = nextExtra([main]);
    const accent = nextExtra([main, side]);
    return {
      main,
      side,
      accent,
      palette: pick(PALETTES, rnd),
      pattern: pick(PATTERNS, rnd),
      layout: pick(LAYOUTS, rnd),
      angle: Math.round((rnd() * 30 - 15) * 10) / 10,
      hue: Math.round(rnd() * 360),
      flip: rnd() < 0.35
    };
  });
}

/** Строит DOM-узел картинки карточки. */
export function renderPicture(pic) {
  const art = document.createElement('div');
  art.className = `art art--${pic.layout} pattern--${pic.pattern}`;
  art.style.setProperty('--c1', pic.palette[0]);
  art.style.setProperty('--c2', pic.palette[1]);
  art.style.setProperty('--angle', `${pic.angle}deg`);
  art.style.setProperty('--hue', `${pic.hue}deg`);

  const main = document.createElement('span');
  main.className = 'emo emo--main';
  main.textContent = pic.main;
  if (pic.flip) main.style.transform += ' scaleX(-1)';

  const side = document.createElement('span');
  side.className = 'emo emo--side';
  side.textContent = pic.side;

  const accent = document.createElement('span');
  accent.className = 'emo emo--accent';
  accent.textContent = pic.accent;

  art.append(main, side, accent);
  return art;
}
