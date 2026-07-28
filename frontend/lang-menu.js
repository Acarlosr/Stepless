/**
 * lang-menu.js — comportamento do seletor de idioma em menu suspenso.
 *
 * Script clássico de propósito (não é módulo): precisa rodar em todas as
 * páginas, inclusive nas que não têm bundler, e não pode depender do
 * <script type="module"> da página — se aquele falhar, o menu ainda abre.
 *
 * A TROCA de idioma continua sendo do setLanguage() de cada página, que já
 * escuta os cliques em `.lang-btn` e marca o ativo com a classe `.active`.
 * Aqui cuidamos só de: abrir/fechar, teclado, e refletir o idioma ativo na
 * bandeira do botão. Observamos a classe `.active` em vez de reimplementar a
 * lógica — assim as duas partes nunca saem de sincronia.
 */
(function () {
  'use strict';

  function init() {
    var menu = document.querySelector('.lang-menu');
    if (!menu) return;

    var trigger = menu.querySelector('.lang-menu-trigger');
    var list = menu.querySelector('.lang-menu-list');
    var flag = menu.querySelector('.lang-menu-flag');
    if (!trigger || !list) return;

    var items = Array.prototype.slice.call(list.querySelectorAll('.lang-btn'));

    function isOpen() {
      return trigger.getAttribute('aria-expanded') === 'true';
    }

    function open() {
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open');
    }

    function close(returnFocus) {
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      if (returnFocus) trigger.focus();
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) close(false); else { open(); if (items[0]) items[0].focus(); }
    });

    // Escolher um idioma fecha o menu. O setLanguage() da página roda no
    // mesmo clique (outro listener) — não interferimos nele.
    items.forEach(function (btn) {
      btn.addEventListener('click', function () { close(true); });
    });

    // Clique fora fecha.
    document.addEventListener('click', function (e) {
      if (isOpen() && !menu.contains(e.target)) close(false);
    });

    // Teclado: Esc fecha, setas navegam, Home/End vão às pontas.
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(true); return; }
      if (!isOpen()) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target === trigger) {
          e.preventDefault(); open(); if (items[0]) items[0].focus();
        }
        return;
      }
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    });

    // Espelha o idioma ativo na bandeira do botão. Observar a classe `.active`
    // cobre tanto o clique quanto a detecção automática feita no carregamento.
    function syncFlag() {
      var active = list.querySelector('.lang-btn.active');
      if (!active || !flag) return;
      var img = active.querySelector('img');
      if (img && img.getAttribute('src')) flag.setAttribute('src', img.getAttribute('src'));
      var name = active.querySelector('span');
      if (name) {
        var label = 'Idioma: ' + name.textContent.trim();
        trigger.setAttribute('title', label);
        trigger.setAttribute('aria-label', label);
      }
    }

    if (window.MutationObserver) {
      var obs = new window.MutationObserver(syncFlag);
      items.forEach(function (btn) {
        obs.observe(btn, { attributes: true, attributeFilter: ['class'] });
      });
    }
    syncFlag();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
