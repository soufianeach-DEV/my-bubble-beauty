// Connexion <-> inscription : la lame s'étire jusqu'à couvrir toute la carte, puis la page suivante s'ouvre couverte
// et la lame se rétracte (forms.css, .auth-reveal). Sans animation voulue, sur mobile ou sans JS : lien ordinaire.
// Chargé sans defer dans <head> : la classe est posée avant le premier affichage, la carte n'apparaît jamais découverte.
const calm = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce), (max-width: 759px)').matches;
try {
  if (sessionStorage.getItem('auth-swap')) {
    sessionStorage.removeItem('auth-swap');
    if (!calm()) document.documentElement.classList.add('auth-reveal');
  }
} catch {} // stockage bloqué : la page s'ouvre sans animation

document.addEventListener('click', (e) => {
  const a = e.target.closest('.auth__blade a');
  if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || calm()) return;
  e.preventDefault();
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    try { sessionStorage.setItem('auth-swap', '1'); } catch {}
    location.assign(a.href);
  };
  document.documentElement.classList.remove('auth-reveal'); // sinon l'animation d'arrivée l'emporte sur la couverture
  a.closest('.auth').classList.add('auth--cover');
  a.closest('.auth__blade').addEventListener('animationend', go, { once: true });
  setTimeout(go, 600); // filet si l'animation ne se termine pas (onglet en arrière-plan)
});
