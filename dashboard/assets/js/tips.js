/* Подсказки: всплывающая плашка у любого узла с data-tip. Владеет одним
   узлом на всю страницу и своими слушателями; наружу отдаёт только hide —
   её зовут те, кто вот-вот перерисует то, к чему подсказка привязана. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.tips = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DELAY = 450;

  function create(deps) {
    var tip = deps.node;
    var timer = null;
    var current = null;

    function anchorOf(node) {
      while (node && node.getAttribute) {
        if (node.getAttribute('data-tip')) return node;
        node = node.parentNode;
      }
      return null;
    }

    function place(el) {
      tip.textContent = el.getAttribute('data-tip');
      tip.style.visibility = 'hidden';
      tip.style.display = 'block';
      var host = el.getBoundingClientRect();
      var box = tip.getBoundingClientRect();
      var left = Math.min(Math.max(8, host.left + (host.width - box.width) / 2),
                          window.innerWidth - box.width - 8);
      var top = host.bottom + 8;
      if (top + box.height > window.innerHeight - 8) {
        top = host.top - box.height - 8;
      }
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(Math.max(8, top)) + 'px';
      tip.style.visibility = 'visible';
    }

    function hide() {
      if (timer) { clearTimeout(timer); timer = null; }
      current = null;
      tip.style.display = 'none';
    }

    /* Делегирование, а не обход всех [data-tip]: строки таблицы и карточки
       перерисовываются, и навешенные обработчики умирали бы вместе с ними. */
    document.addEventListener('mouseover', function (e) {
      var el = anchorOf(e.target);
      if (el === current) return;
      hide();
      current = el;
      if (el) {
        timer = setTimeout(function () {
          if (current === el) place(el);
        }, DELAY);
      }
    });
    document.addEventListener('mouseleave', hide);
    /* С клавиатуры ждать незачем — показываем сразу. */
    document.addEventListener('focusin', function (e) {
      var el = anchorOf(e.target);
      hide();
      if (el) { current = el; place(el); }
    });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);

    return { hide: hide };
  }

  return { create: create };
}));
