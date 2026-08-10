/* Язык запроса: во что превращается набранное в поле поиска.

   Модуль отвечает на два вопроса — совпало ли значение и куда ставить
   подсветку. Ни состояния страницы, ни DOM здесь нет.

   Почему отдельно от text.js: там живёт то, что проверяется одним вызовом,
   а здесь разбор запроса и ответ «не разобралось, вот причина». Доложить
   об этом из text.has было бы некому. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.query = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* Совпадает со всем и молчит. Им отвечает пустой запрос — и он же лежит
     в основе ответа на непонятый шаблон. */
  const ALL = {
    empty: true, problem: null,
    test: function () { return true; },
    ranges: function () { return []; }
  };

  function plain(raw) {
    /* Приводим к нижнему регистру один раз здесь, а не на каждое значение:
       обычный поиск регистр игнорирует, и делать это тысячи раз за
       перерисовку незачем. */
    const needle = raw.toLowerCase();
    return {
      empty: false, problem: null,
      test: function (value) {
        return String(value).toLowerCase().indexOf(needle) !== -1;
      },
      ranges: function (str) {
        const low = String(str).toLowerCase(), out = [];
        let at = 0, found;
        while ((found = low.indexOf(needle, at)) !== -1) {
          out.push([found, found + needle.length]);
          at = found + needle.length;
        }
        return out;
      }
    };
  }

  function regexp(raw) {
    let one, all;
    try {
      /* Две регулярки на один шаблон, и это не расточительство. lastIndex —
         состояние на самом объекте: у экземпляра с флагом g он ползёт от
         вызова к вызову, и один объект, поделённый между отбором строк и
         тремя десятками мест подсветки, начал бы пропускать совпадения
         через раз. Поэтому test ходит по экземпляру без g, а ranges — по
         своему, с g.

         Флаг i стоит всегда: обычный поиск регистр игнорирует, и регулярка,
         которая вела бы себя иначе, молча теряла бы половину на именах
         вроде CVE-2026 против cve-2026. Отключить его изнутри шаблона в
         JavaScript нечем, и это осознанная цена. */
      one = new RegExp(raw, 'i');
      all = new RegExp(raw, 'gi');
    } catch (exc) {
      /* Не разобралось — совпадаем со всем и несём причину: отбор строк
         увидит пустой запрос и покажет всё, а страница объяснит, почему.
         Причину берём у браузера дословно: у Firefox и Chrome тексты
         разные, но оба называют место ошибки, а общий текст от меня не
         назвал бы его вовсе. */
      return {
        empty: true,
        problem: exc && exc.message ? String(exc.message) : String(exc),
        test: ALL.test, ranges: ALL.ranges
      };
    }
    return {
      empty: false, problem: null,
      test: function (value) { return one.test(String(value)); },
      ranges: function (str) {
        const s = String(str), out = [];
        let found;
        all.lastIndex = 0;
        while ((found = all.exec(s)) !== null) {
          out.push([found.index, found.index + found[0].length]);
          /* Совпадение нулевой длины стоит на месте и lastIndex не двигает.
             Без этого сдвига цикл вечен, а вкладка мертва. */
          if (found[0].length === 0) all.lastIndex += 1;
        }
        return out;
      }
    };
  }

  /* raw — что набрано в поле, regex — нажата ли кнопка режима. */
  function compile(raw, regex) {
    const typed = String(raw === null || raw === undefined ? '' : raw);
    if (!typed) return ALL;
    return regex ? regexp(typed) : plain(typed);
  }

  return { compile: compile };
}));
