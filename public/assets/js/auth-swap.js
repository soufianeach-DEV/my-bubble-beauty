// Connexion <-> inscription : la lame s'étire jusqu'à couvrir toute la carte, puis la page suivante la pose de l'autre côté
// (transition de vue entre documents, voir forms.css). Sans animation voulue, sur mobile ou sans JS : lien ordinaire.
document.addEventListener('click', (e) => {
  const a = e.target.closest('.auth__blade a');
  if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  if (document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce), (max-width: 759px)').matches) return;
  e.preventDefault();
  let gone = false;
  const go = () => gone || ((gone = true), location.assign(a.href));
  a.closest('.auth').classList.add('auth--cover');
  a.closest('.auth__blade').addEventListener('animationend', go, { once: true });
  setTimeout(go, 900); // filet si l'animation ne se termine pas (onglet en arrière-plan)
});
