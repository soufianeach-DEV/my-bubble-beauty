// Agenda admin : après « Demander un avis » (WhatsApp s'ouvre dans un autre onglet), l'agenda se recharge
// pour afficher la mention grisée « Avis demandé le … ».
document.addEventListener('submit', (e) => {
  if (!(e.target instanceof HTMLFormElement) || !e.target.hasAttribute('data-wa-ask')) return;
  setTimeout(() => location.reload(), 1500);
});
