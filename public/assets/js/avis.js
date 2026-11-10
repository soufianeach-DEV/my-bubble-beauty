// Section « Avis des clientes » de l'Accueil : avis Google lus sur /api/avis, écrits en texte seul (jamais de HTML venu de l'extérieur).
// Aucune réponse, erreur ou 204 : la section reste cachée.
(function () {
  var sec = document.querySelector('[data-avis]');
  if (!sec || !window.fetch) return;
  var loc = sec.getAttribute('data-locale') || document.documentElement.lang;
  var fill = function (tpl, k, v) { return (sec.getAttribute(tpl) || '').replace('{' + k + '}', v); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  fetch('/api/avis', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.status === 200 ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.reviews || !d.reviews.length) return;
      var num = new Intl.NumberFormat(loc, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
      var month = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' });
      var score = sec.querySelector('[data-avis-score]');
      // « 4,9 sur 5 · 37 avis Google » : la note en gras, le reste du gabarit de la langue autour
      var parts = (sec.getAttribute('data-rating') || '{avg}').split('{avg}');
      if (d.average) {
        score.appendChild(document.createTextNode(parts[0]));
        score.appendChild(el('b', null, num.format(d.average)));
        score.appendChild(document.createTextNode((parts[1] || '') + ' · '));
      }
      score.appendChild(document.createTextNode(fill('data-count', 'n', d.total)));
      var list = sec.querySelector('[data-avis-list]');
      d.reviews.forEach(function (r) {
        var li = el('li', 'avis__item');
        var stars = el('p', 'avis__stars', '★★★★★'.slice(0, r.rating) + '☆☆☆☆☆'.slice(0, 5 - r.rating));
        stars.setAttribute('role', 'img');
        stars.setAttribute('aria-label', fill('data-stars', 'n', r.rating));
        li.appendChild(stars);
        li.appendChild(el('p', 'avis__text', r.text));
        var who = el('p', 'avis__who');
        who.appendChild(el('span', 'avis__initial', (r.author.trim()[0] || 'G').toUpperCase())).setAttribute('aria-hidden', 'true');
        var name = el('span');
        name.appendChild(el('b', null, r.author));
        name.appendChild(document.createTextNode(' · ' + month.format(new Date(r.date))));
        who.appendChild(name);
        li.appendChild(who);
        list.appendChild(li);
      });
      var write = sec.querySelector('[data-avis-write]');
      if (d.write && /^https:\/\//.test(d.write)) { write.href = d.write; write.hidden = false; }
      sec.hidden = false;
    })
    .catch(function () {});
})();
