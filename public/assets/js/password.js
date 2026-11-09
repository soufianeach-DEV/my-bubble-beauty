/* Champs de mot de passe de l'espace cliente : afficher/masquer et indicateur de longueur (ASVS 2.1.8 et 2.1.12).
   Sans ce fichier, le champ et sa règle écrite restent complets ; le serveur refait toujours le contrôle. */
(()=>{
for(const box of document.querySelectorAll('[data-pw]')){
  const input=box.querySelector('input'),btn=box.querySelector('[data-pw-toggle]'),meter=box.querySelector('[data-pw-meter]');
  /* aria-label dit l'action, aria-pressed l'état (œil barré = mot de passe visible) */
  btn.hidden=false;
  btn.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';btn.setAttribute('aria-pressed',show);btn.setAttribute('aria-label',show?btn.dataset.hide:btn.dataset.show)});
  /* Remasqué à l'envoi : le navigateur ne range pas le mot de passe dans l'historique des champs texte */
  input.form&&input.form.addEventListener('submit',()=>{input.type='password';btn.setAttribute('aria-pressed','false');btn.setAttribute('aria-label',btn.dataset.show)});
  if(!meter)continue;
  /* Trois états seulement : l'annonce vocale ne change pas à chaque touche. Longueur en caractères Unicode, comme le serveur */
  const sync=()=>{const n=[...input.value].length;meter.hidden=!n;meter.textContent=n<12?meter.dataset.short:n>128?meter.dataset.long:meter.dataset.ok};
  input.addEventListener('input',sync);sync();
}
})();
