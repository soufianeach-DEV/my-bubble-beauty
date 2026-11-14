/* Repère « JS actif », posé avant l'affichage : les étapes repliables ne se replient qu'avec lui */
document.documentElement.dataset.js='1';
/* Habillage de saison : dernière réponse de /api/saison (gardée 6 h), posée avant l'affichage ; saison.js la met à jour. Jamais l'admin. */
try{const z=JSON.parse(localStorage.getItem('mb-saison')||'null');z&&z.on&&z.until>Date.now()&&!location.pathname.startsWith('/admin')&&(document.documentElement.dataset.saison='hiver')}catch(e){}
try{const s=localStorage,r=document.documentElement,t=s.getItem('mb-theme');s.getItem('mb-motion')==='off'&&(r.dataset.motion='off');if(t==='light'||t==='dark'){r.dataset.theme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.content=t==='dark'?'#1E1615':'#F6ECE8')}}catch(e){}
