/* Mesure d'audience GoatCounter, sans cookie ni identifiant : un pixel par page vue.
   Script local (CSP script-src 'self') ; seul le pixel part vers <code>.goatcounter.com. */
(()=>{
  const s=document.currentScript,ep=s&&s.dataset.gc;
  if(!ep||/^(localhost|127\.|\[::1\])/.test(location.hostname))return;
  const q=new URLSearchParams({p:location.pathname,t:document.title,r:document.referrer,rnd:Math.random().toString(36).slice(2)});
  const img=new Image(1,1);img.alt='';img.referrerPolicy='no-referrer-when-downgrade';
  img.src=ep+'?'+q.toString();
})();
