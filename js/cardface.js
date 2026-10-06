// Лицо карточки: картинка из пака или слово. Доска рисует и то и другое одинаково.

import { renderPicture } from './pictures.js';

export function renderFace(face) {
  if (!face) return null;
  if (face.kind === 'word') {
    const art = document.createElement('div');
    art.className = 'art art--word';
    const span = document.createElement('span');
    span.className = 'word-face';
    span.textContent = face.text;
    art.append(span);
    return art;
  }
  return renderPicture(face);
}
