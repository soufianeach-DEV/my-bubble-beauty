// Page de merci après un avis : « Publier aussi sur Google » copie le texte de l'avis, puis le lien ouvre la fiche Google
// dans un nouvel onglet (comportement normal du lien, gardé même sans JavaScript ou si la copie échoue).
(function () {
  function fallback(text) {
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (e) { /* rien de plus à tenter : la cliente peut copier à la main */ }
    t.remove();
  }
  document.addEventListener('click', function (e) {
    var a = e.target instanceof Element && e.target.closest('[data-copy-review]');
    if (!a) return;
    var src = document.getElementById(a.getAttribute('data-copy-review'));
    var text = src ? src.textContent.trim() : '';
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () { fallback(text); });
    else fallback(text);
  });
})();
