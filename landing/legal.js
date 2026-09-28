/* ============================================================
   BAAKALAI · PAGES LÉGALES · bascule de langue

   Les pages légales n'utilisent PAS le moteur i18n de index.html.
   Deux raisons :

     1. Ce moteur remplace le `textContent` d'un élément par une
        chaîne du dictionnaire. Un document juridique est du HTML
        structuré (titres, listes, tableaux, liens), pas une
        chaîne. Le faire passer par `textContent` l'aplatirait.
     2. Son `renderDynamic` appelle des identifiants qui n'existent
        que sur index.html (`diag-steps`, `action-cards`) et jetterait
        une erreur ici.

   Donc : les deux versions sont écrites en clair dans la page, et
   on n'en montre qu'une. Le français fait foi, l'anglais est une
   traduction de courtoisie.

   La clé de stockage est la même que celle du reste du site
   (`baakalai-lang`) : un visiteur qui a choisi EN sur la page
   d'accueil reste en EN ici, et inversement.
   ============================================================ */

(function () {
  'use strict';

  var STORE_KEY = 'baakalai-lang'; // partagé avec index.html
  var SUPPORTED = ['fr', 'en'];

  function readLang() {
    var stored;
    try {
      stored = window.localStorage.getItem(STORE_KEY);
    } catch (err) {
      // Navigation privée ou stockage refusé : on retombe sur le
      // français sans casser la page.
      stored = null;
    }
    return SUPPORTED.indexOf(stored) !== -1 ? stored : 'fr';
  }

  function writeLang(lang) {
    try {
      window.localStorage.setItem(STORE_KEY, lang);
    } catch (err) {
      // Sans persistance, la bascule vaut pour la page courante.
      // C'est dégradé, pas cassé.
    }
  }

  function apply(lang) {
    var blocks = document.querySelectorAll('[data-legal-lang]');
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].classList.toggle('is-active', blocks[i].dataset.legalLang === lang);
    }

    // `lang` porte la langue réellement affichée : sans ça, un
    // lecteur d'écran annoncerait le texte anglais avec la
    // prononciation française.
    document.documentElement.lang = lang;

    var buttons = document.querySelectorAll('[data-set-lang]');
    for (var j = 0; j < buttons.length; j++) {
      var on = buttons[j].dataset.setLang === lang;
      buttons[j].classList.toggle('active', on);
      buttons[j].setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    // Le chrome de la page (navigation, pied de page) vit en dehors des
    // deux blocs de langue, puisqu'il est commun aux deux. Ses libellés
    // portent donc leurs deux versions en attributs. Sans ça, basculer en
    // anglais laissait une nav française au-dessus d'un texte anglais.
    var labels = document.querySelectorAll('[data-t-fr][data-t-en]');
    for (var m = 0; m < labels.length; m++) {
      var text = lang === 'en' ? labels[m].dataset.tEn : labels[m].dataset.tFr;
      if (text) labels[m].textContent = text;
    }
  }

  function init() {
    apply(readLang());

    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-set-lang]');
      if (!button) return;
      var lang = button.dataset.setLang;
      if (SUPPORTED.indexOf(lang) === -1) return;
      writeLang(lang);
      apply(lang);
    });

    // Date de dernière mise à jour : elle vient du HTML
    // (`data-updated`), jamais de l'horloge du visiteur. Une date
    // qui suit le navigateur donnerait un document « à jour »
    // tous les jours, ce qui est exactement le contraire de ce
    // qu'une mention de version doit garantir.
    var stamps = document.querySelectorAll('[data-updated]');
    for (var k = 0; k < stamps.length; k++) {
      stamps[k].textContent = stamps[k].dataset.updated;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
