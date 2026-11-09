/* Bouton « Imprimer ou enregistrer en PDF » des pages imprimables de l'admin (consentement, bon cadeau). */
document.addEventListener('click',(e)=>{if(e.target.closest('[data-print]'))window.print()});
