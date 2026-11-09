/* Admin, prestations : « Tout sélectionner / Tout désélectionner » et compteur de la sélection.
   Sans ce fichier, les cases restent utilisables une par une et la barre envoie la sélection. */
(()=>{
const bar=document.querySelector('[data-selection]');
if(!bar)return;
const items=()=>[...document.querySelectorAll('[data-select-item]')];
const count=bar.querySelector('[data-selection-count]');
const sync=()=>{const n=items().filter((i)=>i.checked).length;count.textContent=`${n} sélectionnée${n>1?'s':''} sur ${items().length}`};
bar.querySelector('[data-selection-tools]').hidden=false;
bar.addEventListener('click',(e)=>{const b=e.target.closest('[data-select]');if(!b)return;
  const on=b.dataset.select==='all';items().forEach((i)=>{i.checked=on});sync()});
document.addEventListener('change',(e)=>{if(e.target.matches('[data-select-item]'))sync()});
sync();
})();
