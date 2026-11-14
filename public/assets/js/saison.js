/* Habillage d'hiver du site public : demande à /api/saison si la saison est active (réglage de l'admin, dates du 1er décembre
   au 6 janvier), pose <html data-saison="hiver"> (givre et bandeau en CSS) et fait tomber une neige légère sur un canvas.
   Neige : jamais devant les clics (pointer-events:none), lancée après le chargement (aucun effet sur le LCP), arrêtée quand
   l'onglet est caché, 22 flocons sur téléphone, aucune si la visiteuse demande moins d'animations (givre et bandeau restent). */
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
  let w=0,h=0,dpr=1,raf=0,list=[],last=0;
  const size=()=>{dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;c.width=w*dpr;c.height=h*dpr;x.setTransform(dpr,0,0,dpr,0,0);
    const n=w<600?22:Math.min(70,Math.round(w*h/26000));
    while(list.length<n)list.push(make(true));list.length=n};
  const make=any=>({x:Math.random()*w,y:any?Math.random()*h:-8,r:.8+Math.random()*2.2,v:.25+Math.random()*.55,s:Math.random()*6.28,a:.35+Math.random()*.45});
  const tone=()=>getComputedStyle(root).getPropertyValue('--snow').trim()||'255,255,255';
  let rgb=tone();
  const frame=t=>{const dt=Math.min(40,t-(last||t))/16.7;last=t;x.clearRect(0,0,w,h);
    for(const f of list){f.y+=f.v*dt;f.s+=.01*dt;f.x+=Math.sin(f.s)*.35*dt;
      if(f.y>h+8){Object.assign(f,make(false))}
      x.beginPath();x.arc(f.x,f.y,f.r,0,6.283);x.fillStyle=`rgba(${rgb},${f.a})`;x.fill()}
    raf=requestAnimationFrame(frame)};
  const run=()=>{cancelAnimationFrame(raf);last=0;if(!d.hidden)raf=requestAnimationFrame(frame)};
  size();run();
  addEventListener('resize',size);
  d.addEventListener('visibilitychange',run);
  // Thème clair ou sombre changé par le bouton : la couleur des flocons suit
  new MutationObserver(()=>{rgb=tone()}).observe(root,{attributes:true,attributeFilter:['data-theme']});
  return{stop(){cancelAnimationFrame(raf);removeEventListener('resize',size);d.removeEventListener('visibilitychange',run);c.remove();snow=null}};
}
})();
