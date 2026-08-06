/* Всплывающие сообщения: окошки в правом нижнем углу, которые гаснут
   сами. Владеет одним контейнером на всю страницу и таймерами своих
   окошек; наружу отдаёт только show.

   Сообщение о событии не имеет права двигать страницу: человек в этот
   момент читает таблицу, а строка, которая появляется и через десять
   секунд исчезает, увозит таблицу сначала вниз, а потом обратно. Окошко
   лежит поверх страницы и не двигает ничего.

   Окошки собираются узлами, а не строкой в innerHTML: в причине отказа
   стоит имя файла, пришедшее снаружи, и textContent делает его текстом
   по устройству, а не по дисциплине вызывающего.

   Окошко зовётся toast, а не note: классом note на странице уже помечена
   приписка к значению в раскрытой строке («прямой», «унаследован»), и
   вторая вещь под тем же именем молча перекрашивала бы первую. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.toasts = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* Десять секунд — столько же, сколько сообщение о загрузке жило строкой
     под рельсом: хватает прочитать несколько строк, а не хватит — под
     курсором отсчёт останавливается. */
  const LIFE = 10000;
  const FADE = 400;
  /* Угол экрана — не лента: стопка в полстраницы закрывала бы её вместо
     того, чтобы о ней рассказывать. */
  const MAX_TOASTS = 4;
  const MAX_LINES = 6;

  function create(deps) {
    const box = deps.node;
    const clock = deps.clock || { set: (fn, ms) => setTimeout(fn, ms),
                                  clear: (id) => clearTimeout(id) };
    /* Живые окошки в порядке появления: старшее — первое. */
    const live = [];

    function timer(fn, ms) {
      const id = clock.set(fn, ms);
      /* В node таймер держит процесс живым, и сюита досиживала бы срок
         каждого окошка по-настоящему. В браузере setTimeout возвращает
         число, у которого unref нет, и строка ничего не делает. */
      if (id && id.unref) id.unref();
      return id;
    }

    function stop(toast) {
      clock.clear(toast.dim);
      clock.clear(toast.gone);
      toast.dim = null;
      toast.gone = null;
    }

    function drop(toast) {
      stop(toast);
      const at = live.indexOf(toast);
      if (at !== -1) live.splice(at, 1);
      if (toast.el.parentNode) toast.el.parentNode.removeChild(toast.el);
    }

    /* Курсор пришёл: отсчёт стоит, и класс гашения снимается сразу —
       окошко, которое уже догорало, возвращается к жизни, а не остаётся
       прозрачным до ухода курсора. */
    function hold(toast) {
      stop(toast);
      toast.el.className = `toast ${toast.kind}`;
    }

    /* Два независимых таймера, а не вложенных: гашение и уборка — разные
       события, и заводить второе изнутри первого значит связать их
       порядком выполнения там, где связи нет.

       Отсчёт всегда начинается с полного срока: окошко, к которому
       вернулись, не должно гаснуть быстрее того, которое видят впервые. */
    function arm(toast) {
      hold(toast);
      toast.dim = timer(() => {
        toast.el.className = `toast ${toast.kind} fading`;
      }, LIFE);
      toast.gone = timer(() => drop(toast), LIFE + FADE);
    }

    function el(tag, cls, text) {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function listOf(lines) {
      const list = el('ul', 'toast-l');
      /* Режем, только если под «…и ещё N» уходит больше одной строки:
         иначе он занимает ровно место строки и вместо причины сообщает
         о ней. */
      const cut = lines.length > MAX_LINES + 1 ? MAX_LINES : lines.length;
      for (let i = 0; i < cut; i++) list.appendChild(el('li', '', lines[i]));
      if (cut < lines.length) {
        list.appendChild(el('li', 'more', `…и ещё ${lines.length - cut}`));
      }
      return list;
    }

    function show(spec) {
      const lines = (spec && spec.lines) || [];
      if (!lines.length) return;
      const kind = spec.kind === 'error' ? 'error' : 'warn';
      const wrap = el('div', `toast ${kind}`);
      const kill = el('button', 'toast-x', '✕');
      kill.setAttribute('type', 'button');
      kill.setAttribute('aria-label', 'Закрыть');
      wrap.appendChild(kill);
      if (spec.title) wrap.appendChild(el('div', 'toast-t', spec.title));
      wrap.appendChild(listOf(lines));

      const toast = { el: wrap, kind: kind, dim: null, gone: null };
      kill.addEventListener('click', () => drop(toast));
      wrap.addEventListener('mouseenter', () => hold(toast));
      wrap.addEventListener('mouseleave', () => arm(toast));
      /* До крестика доходят и табом: под клавиатурой отсчёт держим так
         же, как под мышью. */
      wrap.addEventListener('focusin', () => hold(toast));
      wrap.addEventListener('focusout', () => arm(toast));

      box.appendChild(wrap);
      live.push(toast);
      /* Лишнее окошко выталкивается сразу, не досиживая своего срока. */
      while (live.length > MAX_TOASTS) drop(live[0]);
      arm(toast);
    }

    return { show };
  }

  return { create };
}));
