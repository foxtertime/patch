/* Реакции на размер и прокрутку окна: высота липкой шапки и кнопка
   «наверх». Владеет своими слушателями; наружу не отдаёт ничего — звать
   этот модуль неоткуда, он сам слушает окно.

   Про карточки здесь не знают: пересчитать их ширину умеет только тот, у
   кого есть узлы рядов, поэтому пересчёт приходит доводом onResize. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.viewport = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(deps) {
    const controls = deps.controls, toTop = deps.toTop;
    const onResize = deps.onResize || function () {};

    function syncStickyOffset() {
      if (!controls || !document.documentElement.style.setProperty) return;
      document.documentElement.style.setProperty(
        '--controls-h', controls.getBoundingClientRect().height + 'px');
    }

    /* Порог — высота окна, а не круглое число точек: «ниже первого экрана»
       человек видит глазами, а «ниже шестисот точек» ни о чём не говорит и
       на разных окнах срабатывает по-разному. */
    function syncToTop() {
      toTop.hidden = window.pageYOffset <= window.innerHeight;
    }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(syncStickyOffset).observe(controls);
    } else {
      window.addEventListener('resize', syncStickyOffset);
    }
    /* Ширина карточки посчитана от ширины окна и переживает её изменение не
       сама: окно сузили — в строку влезает меньше, и делить надо заново. */
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', syncToTop);

    toTop.addEventListener('click', () => {
      /* Плавную прокрутку понимают не все браузеры, и её отдельно просят
         отключить те, кому от движения плохо. В обоих случаях поднимаемся
         прыжком: доехать важнее, чем доехать красиво. */
      const smooth = 'scrollBehavior' in document.documentElement.style
        && !(window.matchMedia
             && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (smooth) window.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo(0, 0);
    });

    syncStickyOffset();
    /* Браузер восстанавливает прокрутку при перезагрузке, и страница может
       открыться уже внизу — тогда кнопка нужна сразу, не дожидаясь, пока
       человек тронет колесо. */
    syncToTop();
  }

  return { create };
}));
