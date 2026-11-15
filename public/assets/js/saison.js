/* Habillage d'hiver du site public : demande à /api/saison si la saison est active (réglage de l'admin, dates du 1er décembre
   au 6 janvier), pose <html data-saison="hiver"> (givre et bandeau en CSS) et fait tomber une neige légère sur un canvas.
   Neige : jamais devant les clics (pointer-events:none), lancée après le chargement (aucun effet sur le LCP), arrêtée quand
   l'onglet est caché, peu de flocons sur téléphone, aucune si la visiteuse demande moins d'animations (givre et bandeau restent).
   Neige « bokeh » : halos ronds et doux d'un blanc légèrement chaud (accordé au rose poudré et au doré), sur quatre plans :
   loin, milieu, près, et quelques gros flocons très flous et transparents qui passent « devant l'objectif ». Balancement et vent doux.
   Images en dégradé radial seul (pas de filter blur), dessin sans save/rotate/restore : peu de calcul. */
(()=>{
const d=document,root=d.documentElement,KEY='mb-saison';
const save=on=>{try{localStorage.setItem(KEY,JSON.stringify({on,until:Date.now()+6*3600e3}))}catch(e){}};
let snow=null;
const set=on=>{if(on){root.dataset.saison='hiver';start()}else{delete root.dataset.saison;snow&&snow.stop()}};
fetch('/api/saison',{credentials:'omit'}).then(r=>r.ok?r.json():null).then(j=>{if(!j)return;save(!!j.on);set(!!j.on)}).catch(()=>{});
if(root.dataset.saison)start();

function start(){
  if(snow)return;
  const quiet=matchMedia('(prefers-reduced-motion: reduce)');
  if(quiet.matches||root.dataset.motion==='off')return;
  const go=()=>{if(snow||!root.dataset.saison)return;snow=flakes();quiet.addEventListener('change',()=>quiet.matches&&snow&&snow.stop())};
  const later=()=>('requestIdleCallback' in window?requestIdleCallback(go,{timeout:2500}):setTimeout(go,1200));
  d.readyState==='complete'?later():addEventListener('load',later,{once:true});
}

function flakes(){
  const c=d.createElement('canvas');
  c.className='saison-snow';c.setAttribute('aria-hidden','true');
  d.body.append(c);
  const x=c.getContext('2d');
  let w=0,h=0,dpr=1,raf=0,list=[],last=0,sprites=[];
  // Quatre plans : loin (petits, pâles, lents), milieu, près (plus nets), macro (gros, très flous, transparents, rapides, rares)
  // r = rayon visible en px ; soft = part floue du halo (0 net, 1 tout en dégradé) ; n = part des flocons de ce plan
  const PLANES=[{min:1.2,max:2.2,v:.35,a:.6,soft:.75,n:.42},{min:2,max:3.2,v:.6,a:.8,soft:.6,n:.32},{min:3,max:4.6,v:.95,a:.92,soft:.45,n:.2},{min:6,max:12,v:1.7,a:.3,soft:1,n:.06}];
  // Halo rond : cœur blanc chaud puis dégradé jusqu'à zéro. Thème clair : ombre chaude très douce autour (sinon le blanc se perd sur le rose), sauf pour les gros flocons flous qui feraient des anneaux
  const halo=(soft,dark)=>{const S=64,o=d.createElement('canvas');o.width=o.height=S;const g=o.getContext('2d');
    if(!dark&&soft<1){const sh=g.createRadialGradient(32,32,0,32,32,32);sh.addColorStop(.45,'rgba(120,85,75,.22)');sh.addColorStop(1,'rgba(120,85,75,0)');g.fillStyle=sh;g.fillRect(0,0,S,S)}
    const r=g.createRadialGradient(32,32,0,32,32,26);
    r.addColorStop(0,'rgba(255,252,250,1)');r.addColorStop(Math.max(.05,1-soft),'rgba(255,252,250,.95)');r.addColorStop(1,'rgba(255,252,250,0)');
    g.fillStyle=r;g.fillRect(0,0,S,S);return o};
  const paint=()=>{const dark=root.dataset.theme==='dark'||(root.dataset.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);
    sprites=PLANES.map(p=>halo(p.soft,dark))};
  const pick=()=>{let u=Math.random(),p=0;while(p<PLANES.length-1&&(u-=PLANES[p].n)>0)p++;return p};
  const make=any=>{const p=pick(),P=PLANES[p];
    return{p,x:Math.random()*w,y:any?Math.random()*h:-40,z:P.min+Math.random()*(P.max-P.min),v:P.v*(.8+Math.random()*.4),s:Math.random()*6.283,sw:.4+Math.random()*.8}};
  const size=()=>{dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;c.width=w*dpr;c.height=h*dpr;x.setTransform(dpr,0,0,dpr,0,0);
    // Téléphone : peu de flocons ; PC : environ 70 au plus
    const n=w<600?22:Math.min(72,Math.round(w*h/18000));
    while(list.length<n)list.push(make(true));list.length=n;list.sort((a,b)=>a.p-b.p)};
  const frame=t=>{const dt=Math.min(40,t-(last||t))/16.7;last=t;x.clearRect(0,0,w,h);
    // Vent doux qui change lentement de sens, plus sensible sur les plans proches
    const wind=Math.sin(t*.0002)*.4+Math.sin(t*.0006)*.15;
    for(const f of list){f.y+=f.v*dt;f.s+=.012*dt;
      f.x+=(Math.sin(f.s)*f.sw+wind*(.4+f.p*.35))*dt;
      if(f.y>h+40||f.x<-50||f.x>w+50)Object.assign(f,make(false));
      // L'image fait 64 px pour un halo de rayon 26 : facteur 64/26 ≈ 2,46 sur le rayon visible
      const z=f.z*2.46;x.globalAlpha=PLANES[f.p].a;x.drawImage(sprites[f.p],f.x-z,f.y-z,z*2,z*2)}
    raf=requestAnimationFrame(frame)};
  const run=()=>{cancelAnimationFrame(raf);last=0;if(!d.hidden)raf=requestAnimationFrame(frame)};
  paint();size();run();
  addEventListener('resize',size);
  d.addEventListener('visibilitychange',run);
  // Thème clair ou sombre changé : l'ombre douce des flocons suit
  new MutationObserver(paint).observe(root,{attributes:true,attributeFilter:['data-theme']});
  return{stop(){cancelAnimationFrame(raf);removeEventListener('resize',size);d.removeEventListener('visibilitychange',run);c.remove();snow=null}};
}
})();
