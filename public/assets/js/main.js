/* My Bubble — effets progressifs, sans dépendance. */
(()=>{
const d=document,root=d.documentElement,W=window,mm=q=>W.matchMedia(q);
const reduced=mm('(prefers-reduced-motion: reduce)');
const off=()=>root.dataset.motion==='off'||reduced.matches;
let K=1;const readK=()=>{K=parseFloat(getComputedStyle(root).getPropertyValue('--k'))||0};

/* 1. Bouton pause des animations (WCAG 2.2.2) */
const tg=d.querySelector('.motion-toggle');
if(tg){
  /* Le libellé dit l'action ; pas d'aria-pressed en plus, sinon « Relancer… enfoncé » est ambigu */
  tg.removeAttribute('aria-pressed');
  const lbl=tg.querySelector('span'),sync=()=>{const p=root.dataset.motion==='off';lbl.textContent=p?tg.dataset.on:tg.dataset.off};
  sync();
  tg.addEventListener('click',()=>{
    const p=root.dataset.motion!=='off';
    p?root.dataset.motion='off':delete root.dataset.motion;
    try{localStorage.setItem('mb-motion',p?'off':'on')}catch(e){}
    sync();readK();px&&px();
  });
}

/* 1 bis. Thème clair ou sombre : le choix du visiteur (mémorisé) prime sur le réglage de l'appareil */
const th=d.querySelector('.theme-btn');
if(th){
  const dark=mm('(prefers-color-scheme: dark)'),metas=d.querySelectorAll('meta[name="theme-color"]');
  const cur=()=>root.dataset.theme||(dark.matches?'dark':'light');
  /* Bouton icône : le nom accessible et l'info-bulle disent l'action */
  const sync=()=>{const t=cur(),l=t==='dark'?th.dataset.light:th.dataset.dark;th.setAttribute('aria-label',l);th.title=l;
    root.dataset.theme&&metas.forEach(m=>m.content=t==='dark'?'#1E1615':'#F6ECE8')};
  th.hidden=false;sync();
  th.addEventListener('click',()=>{const t=cur()==='dark'?'light':'dark';root.dataset.theme=t;
    try{localStorage.setItem('mb-theme',t)}catch(e){}sync()});
  dark.addEventListener('change',sync);
}

/* 2. Halos de section + pause hors écran */
const io=new IntersectionObserver(es=>es.forEach(e=>{
  const t=e.target;
  if(t.classList.contains('lit')&&e.isIntersecting)t.classList.add('is-lit');
  if(t.hasAttribute('data-loop'))t.classList.toggle('is-off',!e.isIntersecting);
}),{threshold:.15});
d.querySelectorAll('.lit,[data-loop]').forEach(el=>io.observe(el));

/* 3. Lumière qui suit le curseur (pointeur fin uniquement) */
if(mm('(pointer: fine)').matches){
  d.querySelectorAll('.cursor-zone').forEach(z=>{
    const g=z.querySelector('.cursor-glow');if(!g)return;
    let x=0,y=0,tx=0,ty=0,raf=0;
    const step=()=>{x+=(tx-x)*.08;y+=(ty-y)*.08;g.style.transform=`translate3d(${x}px,${y}px,0)`;
      raf=Math.abs(tx-x)+Math.abs(ty-y)>.5?requestAnimationFrame(step):0};
    z.addEventListener('pointermove',e=>{if(off()||e.pointerType!=='mouse')return;
      const r=z.getBoundingClientRect();tx=e.clientX-r.left;ty=e.clientY-r.top;
      if(!z.classList.contains('has-cursor')){x=tx;y=ty;z.classList.add('has-cursor');g.style.willChange='transform'}
      raf||(raf=requestAnimationFrame(step))});
    z.addEventListener('pointerleave',()=>{z.classList.remove('has-cursor');g.style.willChange='auto'});
  });
}

/* 4. Parallax : repli JS si pas de scroll-driven animations */
var px=null;
if(!CSS.supports('animation-timeline','view()')){
  const hero=[...d.querySelectorAll('.px-far,.px-mid')],vis=new Set(),view=[...d.querySelectorAll('.px-halo,.frame img')];
  let tick=0;
  const vio=new IntersectionObserver(es=>{es.forEach(e=>e.isIntersecting?vis.add(e.target):vis.delete(e.target));tick||(tick=requestAnimationFrame(px))});
  view.forEach(el=>vio.observe(el));
  px=()=>{tick=0;const h=innerHeight,p=Math.min(scrollY/h,1);
    hero.forEach(el=>{el.style.transform=`translate3d(0,${p*h*(el.classList.contains('px-far')?.15:.08)*K}px,0)`});
    vis.forEach(el=>{const r=el.getBoundingClientRect(),t=(h-r.top)/(h+r.height),a=el.tagName==='IMG'?20:90;
      el.style.transform=`translate3d(0,${(t*2-1)*a*K}px,0)`});
  };
  addEventListener('scroll',()=>{tick||(tick=requestAnimationFrame(px))},{passive:true});
  addEventListener('resize',()=>{readK();px()});
  requestAnimationFrame(px);
}
readK();reduced.addEventListener('change',()=>{readK();px&&px()});

/* 5. Filtres des tarifs */
const fl=d.querySelector('.filters');
if(fl){
  fl.hidden=false;const groups=d.querySelectorAll('.price-group'),st=d.getElementById('filter-status');
  const pick=(b,say)=>{if(!b)return;fl.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));
    /* Rangée défilante sur mobile : la puce choisie revient au centre si elle est hors de vue */
    const r=b.getBoundingClientRect(),q=fl.getBoundingClientRect();(r.left<q.left||r.right>q.right)&&(fl.scrollLeft+=r.left-q.left-(q.width-r.width)/2);
    const f=b.dataset.filter;groups.forEach(g=>g.hidden=f!=='all'&&g.dataset.cat!==f);
    say&&st&&(st.textContent=b.dataset.status||'')};
  /* Le filtre marqué dans le HTML (Visage) s'applique dès le chargement */
  pick(fl.querySelector('[aria-pressed="true"]')||fl.querySelector('button'));
  fl.addEventListener('click',e=>pick(e.target.closest('button'),1));
  /* Arrivée avec un #tarif-… dans l'URL (lien partagé, rechargement, retour) : afficher sa catégorie */
  const fromHash=()=>{const g=location.hash.startsWith('#tarif-')&&d.getElementById(location.hash.slice(1));
    if(!g||!g.hidden)return;pick(fl.querySelector(`[data-filter="${g.dataset.cat}"]`)||fl.querySelector('[data-filter="all"]'));g.scrollIntoView()};
  fromHash();addEventListener('hashchange',fromHash);
  /* Un lien vers un tarif masqué par le filtre affiche sa catégorie avant de défiler */
  d.addEventListener('click',e=>{const a=e.target.closest('a[href^="#tarif-"]');if(!a)return;
    const g=d.getElementById(a.getAttribute('href').slice(1));
    g&&g.hidden&&pick(fl.querySelector(`[data-filter="${g.dataset.cat}"]`)||fl.querySelector('[data-filter="all"]'),1)});
}

/* 6. Galerie : agrandissement dans <dialog> */
const dlg=d.querySelector('dialog.lightbox');
if(dlg&&dlg.showModal){
  const img=dlg.querySelector('img'),cap=dlg.querySelector('figcaption');
  d.querySelectorAll('.frame').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();
    const s=b.querySelector('img');img.src=b.getAttribute('href');img.alt=s.alt;img.width=s.dataset.w;img.height=s.dataset.h;cap.textContent=s.alt;dlg.showModal()}));
  dlg.querySelector('.lightbox__close').addEventListener('click',()=>dlg.close());
  dlg.addEventListener('click',e=>{e.target===dlg&&dlg.close()});
}

/* 7. Menu mobile et choix de langue : se ferment sur un lien, un clic ailleurs ou Échap */
const menus=[...d.querySelectorAll('details.mnav,details.langsel')];
menus.forEach(m=>{
  m.addEventListener('click',e=>{e.target.closest('a')&&(m.open=false)});
  m.addEventListener('toggle',()=>{m.open&&menus.forEach(o=>o!==m&&(o.open=false))});
  m.addEventListener('focusout',e=>{e.relatedTarget&&!m.contains(e.relatedTarget)&&(m.open=false)});
});
d.addEventListener('click',e=>menus.forEach(m=>{m.open&&!m.contains(e.target)&&(m.open=false)}));
d.addEventListener('keydown',e=>{if(e.key!=='Escape')return;
  menus.forEach(m=>{if(m.open){m.open=false;m.querySelector('summary').focus()}})});
})();
