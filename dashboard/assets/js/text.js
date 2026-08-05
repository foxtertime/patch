/* Строки и числа: экранирование, подсветка запроса, склонение, время.
   Ничего не знает ни о данных страницы, ни о DOM — сюда попадает только
   то, что можно проверить одним вызовом. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.text = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Экранирует и подсвечивает вхождения текущего запроса. Всё, что попадает
     в DOM из данных, проходит либо через esc(), либо через hl(). */
  function hl(s, q) {
    s = String(s === null || s === undefined ? '' : s);
    if (!q) return esc(s);
    let low = s.toLowerCase(), out = '', from = 0, at;
    while ((at = low.indexOf(q, from)) !== -1) {
      out += esc(s.slice(from, at)) + '<span class="hit">'
          + esc(s.slice(at, at + q.length)) + '</span>';
      from = at + q.length;
    }
    return out + esc(s.slice(from));
  }

  /* Значение по ключу, который пришёл из данных. Голый объект несёт свойства
     Object.prototype, и на ключ «constructor» — а так может называться класс
     патчей, имена им задаёт конфиг — он отвечает функцией Object вместо
     «ничего нет». Она уезжает прямо на экран: подписью в карточке, числом в
     полоске (width:NaN%), именем css-класса. */
  function own(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  }

  function has(value, q) {
    return String(value === null || value === undefined ? '' : value)
      .toLowerCase().indexOf(q) !== -1;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* Время сбора для подписи узла: дата и время до минуты. Строку режем, а не
     разбираем: «неизвестно» из неё выдумывать нечего, формат задан самим
     dashboard, а разбор увёл бы подпись в часовой пояс читателя — снапшот
     же собран там, где стоит хаб. */
  function stampOf(value) {
    let text = String(value === null || value === undefined ? '' : value);
    return text.slice(0, 16).replace('T', ' ');
  }

  const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

  /* Расстояние между соседними снапшотами — над отрезком рельса. Единица
     берётся крупная: под узлами и так стоят полные даты, а от подписи нужен
     порядок величины — «месяц», а не «31 день 4 часа». Меньше минуты не
     подписываем вовсе: «0 мин» занял бы место, ничего не сообщив.

     Порядок концов не важен, берётся модуль: цепочку переставляют руками, и
     у переставленной пары расстояние то же самое. */
  function gapLabel(from, to) {
    let a = Date.parse(from), b = Date.parse(to), ms;
    if (isNaN(a) || isNaN(b)) return '';
    ms = Math.abs(b - a);
    if (ms < MINUTE) return '';
    if (ms < HOUR) return Math.round(ms / MINUTE) + ' мин';
    if (ms < 2 * DAY) return Math.round(ms / HOUR) + ' ч';
    if (ms < 60 * DAY) return Math.round(ms / DAY) + ' дн';
    return Math.round(ms / (30 * DAY)) + ' мес';
  }

  function keys(obj) {
    let out = [];
    for (var k in obj) { if (obj.hasOwnProperty(k)) out.push(k); }
    return out;
  }

  function setFrom(list) {
    let out = {};
    for (var i = 0; i < (list || []).length; i++) out[list[i]] = 1;
    return out;
  }

  /* Адреса приходят из koji и GitLab, то есть снаружи. В href пускаем только
     http(s) и относительный путь: javascript: в ссылке нам ни к чему.
     «//host/x» — не относительный путь, а ссылка на чужой хост по текущей
     схеме, поэтому её тоже не пускаем. */
  function safeUrl(url) {
    if (!url) return null;
    return /^(https?:\/\/|\/(?!\/))/i.test(String(url)) ? String(url) : null;
  }

  return { esc: esc, hl: hl, own: own, has: has, keys: keys,
           setFrom: setFrom, slug: slug, plural: plural, stampOf: stampOf,
           gapLabel: gapLabel, safeUrl: safeUrl };
}));
