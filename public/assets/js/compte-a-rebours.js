/* Accueil admin : « dans 1 h 05 » avant le prochain rendez-vous, recalculé chaque minute. Sans ce fichier, le texte du serveur reste. */
(()=>{
const el=document.querySelector('[data-countdown]');
if(!el)return;
const at=Date.parse(el.dateTime);
const tick=()=>{const m=Math.round((at-Date.now())/60000);
  el.textContent=m<=0?'maintenant':m<60?`dans ${m} min`:`dans ${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}`};
tick();setInterval(tick,60000);
})();
