/* Habillage d'hiver du site public : demande à /api/saison si la saison est active (réglage de l'admin, dates du 1er décembre
   au 6 janvier), pose <html data-saison="hiver"> (givre et bandeau en CSS) et fait tomber une neige légère sur un canvas.
   Neige : jamais devant les clics (pointer-events:none), lancée après le chargement (aucun effet sur le LCP), arrêtée quand
   l'onglet est caché, peu de flocons sur téléphone, aucune si la visiteuse demande moins d'animations (givre et bandeau restent).
   Flocons en cristaux à 6 branches sur trois plans (loin, milieu, près), rotation lente, balancement et vent. */
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
  // Trois plans : loin (petits, flous, lents, plus pâles), milieu, près (gros, nets, plus rapides)
  const PLANES=[{min:6,max:10,v:.35,a:.6,blur:1.4},{min:10,max:15,v:.6,a:.8,blur:.5},{min:15,max:22,v:.95,a:.95,blur:0}];
  // z = taille visible du flocon (6 à 22 px) ; le cristal occupe 50 px de son image de 64 px, d'où le facteur 1,28 au dessin
  // Cristal à 6 branches, dessiné une fois par plan dans une petite image : contour sombre léger puis trait blanc,
  // visible sur fond clair comme sur fond sombre
  const crystal=(blur,dark)=>{const S=64,o=d.createElement('canvas');o.width=o.height=S;const g=o.getContext('2d');
    g.translate(S/2,S/2);g.lineCap='round';if(blur)g.filter=`blur(${blur}px)`;
    const arms=(lw,col)=>{g.strokeStyle=col;g.lineWidth=lw;for(let i=0;i<6;i++){g.save();g.rotate(i*Math.PI/3);g.beginPath();
      g.moveTo(0,0);g.lineTo(0,-25);
      for(const [at,len] of [[-11,7],[-18,5]]){g.moveTo(0,at);g.lineTo(-len,at-len);g.moveTo(0,at);g.lineTo(len,at-len)}
      g.stroke();g.restore()}};
    arms(5.5,dark?'rgba(15,25,40,.45)':'rgba(70,100,130,.55)');arms(2.6,'rgba(255,255,255,.97)');
    g.fillStyle='#fff';g.beginPath();g.arc(0,0,3.2,0,6.283);g.fill();return o};
  const paint=()=>{const dark=root.dataset.theme==='dark'||(root.dataset.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);
    sprites=PLANES.map(p=>crystal(p.blur,dark))};
  const make=any=>{const p=Math.random()<.45?0:Math.random()<.6?1:2,P=PLANES[p];
    return{p,x:Math.random()*w,y:any?Math.random()*h:-30,z:P.min+Math.random()*(P.max-P.min),v:P.v*(.8+Math.random()*.4),
      s:Math.random()*6.283,sw:.4+Math.random()*.8,r:Math.random()*6.283,vr:(Math.random()-.5)*.012}};
  const size=()=>{dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;c.width=w*dpr;c.height=h*dpr;x.setTransform(dpr,0,0,dpr,0,0);
    // Téléphone : gros flocons mais peu ; PC : environ 45
    const n=w<600?14:Math.min(48,Math.round(w*h/28000));
    while(list.length<n)list.push(make(true));list.length=n;list.sort((a,b)=>a.p-b.p)};
  const frame=t=>{const dt=Math.min(40,t-(last||t))/16.7;last=t;x.clearRect(0,0,w,h);
    // Vent : souffle lent qui change de sens, plus sensible sur les flocons proches
    const wind=Math.sin(t*.00023)*.5+Math.sin(t*.00071)*.25;
    for(const f of list){f.y+=f.v*dt;f.s+=.012*dt;f.r+=f.vr*dt;
      f.x+=(Math.sin(f.s)*f.sw+wind*(.4+f.p*.4))*dt;
      if(f.y>h+30||f.x<-40||f.x>w+40)Object.assign(f,make(false));
      x.save();x.globalAlpha=PLANES[f.p].a;x.translate(f.x,f.y);x.rotate(f.r);x.drawImage(sprites[f.p],-f.z*.64,-f.z*.64,f.z*1.28,f.z*1.28);x.restore()}
    raf=requestAnimationFrame(frame)};
  const run=()=>{cancelAnimationFrame(raf);last=0;if(!d.hidden)raf=requestAnimationFrame(frame)};
  paint();size();run();
  addEventListener('resize',size);
  d.addEventListener('visibilitychange',run);
  // Thème clair ou sombre changé : le contour des flocons suit
  new MutationObserver(paint).observe(root,{attributes:true,attributeFilter:['data-theme']});
  return{stop(){cancelAnimationFrame(raf);removeEventListener('resize',size);d.removeEventListener('visibilitychange',run);c.remove();snow=null}};
}
})();
