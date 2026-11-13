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
  const txt=th.querySelector('[data-theme-txt]');
  const sync=()=>{const t=cur(),l=t==='dark'?th.dataset.light:th.dataset.dark;th.setAttribute('aria-label',l);th.title=l;txt&&(txt.textContent=l);
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

/* 4b. Horaires : le jour courant (heure de Bruxelles) est mis en évidence */
{const day=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Brussels",weekday:"short"}).format(new Date()),n=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(day)+1;const li=d.querySelector(`.hours li[data-day="${n}"]`);li&&(li.classList.add("is-today"),li.setAttribute("aria-current","date"))}

/* 5. Filtres des tarifs */
const fl=d.querySelector('.filters');
if(fl){
  fl.hidden=false;const groups=d.querySelectorAll('.price-group'),st=d.getElementById('filter-status');
  const pick=(b,say)=>{if(!b)return;fl.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));
    /* Rangée défilante sur mobile : la puce choisie revient au centre si elle est hors de vue */
    const r=b.getBoundingClientRect(),q=fl.getBoundingClientRect();(r.left<q.left||r.right>q.right)&&(fl.scrollLeft+=r.left-q.left-(q.width-r.width)/2);
    const f=b.dataset.filter;groups.forEach(g=>g.hidden=f!=='all'&&g.dataset.cat!==f);d.querySelectorAll('.tarifs__part').forEach(p=>p.hidden=!p.querySelector('.price-group:not([hidden])'));
    say&&st&&(st.textContent=b.dataset.status||'')};
  /* Le filtre marqué dans le HTML (Visage) s'applique dès le chargement */
  pick(fl.querySelector('[aria-pressed="true"]')||fl.querySelector('button'));
  fl.addEventListener('click',e=>pick(e.target.closest('button'),1));
  /* Rangée qui glisse (mobile) : fondu et flèche seulement du côté où il reste des filtres cachés */
  const wrap=fl.parentElement,edges=()=>{const max=fl.scrollWidth-fl.clientWidth;
    wrap.toggleAttribute('data-more-left',fl.scrollLeft>4);wrap.toggleAttribute('data-more-right',fl.scrollLeft<max-4)};
  fl.addEventListener('scroll',edges,{passive:true});addEventListener('resize',edges);edges();
  /* Arrivée avec un #tarif-… dans l'URL (lien partagé, rechargement, retour) : afficher sa catégorie */
  const fromHash=()=>{const g=location.hash.startsWith('#tarif-')&&d.getElementById(location.hash.slice(1));
    if(!g||!g.hidden)return;pick(fl.querySelector(`[data-filter="${g.dataset.cat}"]`)||fl.querySelector('[data-filter="all"]'));g.scrollIntoView();
    /* À l'arrivée, les images qui se chargent décalent la page : on revient au groupe une fois tout chargé */
    d.readyState!=='complete'&&addEventListener('load',()=>g.scrollIntoView({behavior:'instant'}),{once:true})};
  fromHash();addEventListener('hashchange',fromHash);
  /* Un lien vers un tarif masqué par le filtre affiche sa catégorie, puis défile lui-même jusqu'au groupe :
     on ne compte pas sur le défilement du navigateur, qui a pu viser le groupe encore masqué */
  d.addEventListener('click',e=>{const a=e.target.closest('a[href^="#tarif-"]');if(!a)return;
    const id=a.getAttribute('href').slice(1),g=d.getElementById(id);if(!g)return;
    e.preventDefault();
    g.hidden&&pick(fl.querySelector(`[data-filter="${g.dataset.cat}"]`)||fl.querySelector('[data-filter="all"]'),1);
    location.hash!=='#'+id&&history.pushState(null,'','#'+id);g.scrollIntoView()});
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

/* 6 bis. Compte dans l'en-tête des pages pré-rendues : sans témoin mb_in (aucune donnée), aucun appel.
   Avec lui, /api/moi dit qui est connecté ; une réponse 204 efface le témoin périmé. */
const hd=d.querySelector('.site-header');
if(hd&&!hd.hasAttribute('data-acct-known')&&/(?:^|;\s*)mb_in=1(?:;|$)/.test(d.cookie)){
  fetch('/api/moi',{credentials:'same-origin',cache:'no-store'}).then(r=>r.status===200?r.json():null).then(me=>{
    if(!me){d.cookie='mb_in=; Path=/; Max-Age=0; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');return}
    const k=me.staff?'staff':'client';
    hd.querySelectorAll('[data-acct]').forEach(e=>{e.hidden=e.dataset.acct!==k});
    hd.querySelectorAll('[data-initials]').forEach(e=>{e.textContent=me.initials});
  }).catch(()=>{});
}

/* 6 ter. Admin, nouveau rendez-vous : choisir la prestation montre tout de suite les créneaux (bouton « look » du formulaire) */
d.querySelectorAll('select[data-autolook]').forEach(s=>s.addEventListener('change',()=>{const f=s.form;if(!f||!s.value)return;
  // look=1 : « prestation choisie », distinct du bouton du jour (look=jour) qui ouvre l'étape Heure
  const h=Object.assign(d.createElement('input'),{type:'hidden',name:'look',value:'1'});f.append(h);f.requestSubmit()}));

/* 6 quater. Nouveau rendez-vous pas à pas : l'étape Soin s'ouvre dès qu'une cliente (ou une personne sans compte) est saisie */
const nb=d.querySelector('form.nb');
if(nb){const soin=nb.querySelector('[data-step="soin"]');
  nb.addEventListener('input',e=>{if(!soin||!['client','name'].includes(e.target.name))return;
    const who=['client','name'].some(n=>(nb.elements[n]&&nb.elements[n].value||'').trim());
    soin.toggleAttribute('data-locked',!who&&!nb.elements.service.value)});
  // Prestation choisie : l'étape Date s'ouvre tout de suite, l'envoi automatique suit
  nb.addEventListener('change',e=>{e.target.name==='service'&&e.target.value&&nb.querySelector('[data-step="date"]')?.removeAttribute('data-locked')});
}

/* 6 quinquies. Pop-ups de l'admin (<dialog class="modal">) : un lien [data-dialog] ouvre la boîte en modal (focus piégé, Échap) ;
   × ou clic sur le voile la ferment. Boîte ouverte par l'URL (repli sans JS) : rouverte en modal, l'URL est nettoyée à la fermeture. */
d.querySelectorAll('dialog.modal').forEach(m=>{
  if(!m.showModal)return;
  if(m.hasAttribute('open')){m.close();m.showModal()}
  m.addEventListener('click',e=>{e.target===m&&m.close()});
  m.querySelectorAll('[data-close]').forEach(x=>x.addEventListener('click',e=>{e.preventDefault();m.close()}));
  m.addEventListener('close',()=>{const u=new URL(location.href);['cal','fermer','du','au','fiche'].forEach(k=>u.searchParams.delete(k));history.replaceState(null,'',u)});
});
d.querySelectorAll('[data-dialog]').forEach(a=>a.addEventListener('click',e=>{const m=d.getElementById(a.dataset.dialog);if(m&&m.showModal){e.preventDefault();m.showModal()}}));

/* 6 sexies. Admin : champ + datalist remplacé par une liste maison accessible (combobox). Le datalist du navigateur filtre sur
   la valeur entière : une fois une cliente choisie, un nouveau clic ne montrait plus rien. Ici, un clic sur un champ rempli
   remontre toute la liste, la saisie filtre (sans accents), flèches / Entrée / Échap au clavier. Sans JS, le datalist reste. */
d.querySelectorAll('.admin-shell input[list]').forEach((inp,n)=>{
  const dl=d.getElementById(inp.getAttribute('list'));if(!dl)return;
  const all=[...dl.options].map(o=>o.value);
  inp.removeAttribute('list');
  const wrap=d.createElement('div');wrap.className='combo';inp.before(wrap);wrap.append(inp);
  const lb=d.createElement('ul');lb.id='combo-'+n;lb.className='combo__list';lb.setAttribute('role','listbox');lb.hidden=true;
  const btn=d.createElement('button');btn.type='button';btn.className='combo__btn';btn.tabIndex=-1;btn.setAttribute('aria-label','Afficher toute la liste');
  wrap.append(btn,lb);
  [['role','combobox'],['aria-autocomplete','list'],['aria-expanded','false'],['aria-controls',lb.id]].forEach(([k,v])=>inp.setAttribute(k,v));
  const norm=t=>t.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  let items=[],act=-1;
  const close=()=>{lb.hidden=true;inp.setAttribute('aria-expanded','false');inp.removeAttribute('aria-activedescendant');act=-1};
  const mark=i=>{act=i;[...lb.children].forEach((li,j)=>li.setAttribute('aria-selected',j===i?'true':'false'));
    if(i>=0){const li=lb.children[i];inp.setAttribute('aria-activedescendant',li.id);li.scrollIntoView({block:'nearest'})}};
  const open=full=>{const q=norm(inp.value.trim());
    items=full||!q||all.includes(inp.value)?all:all.filter(v=>norm(v).includes(q));
    lb.replaceChildren(...items.map((v,j)=>Object.assign(d.createElement('li'),{id:lb.id+'-'+j,textContent:v})));
    [...lb.children].forEach(li=>li.setAttribute('role','option'));
    if(!items.length)lb.append(Object.assign(d.createElement('li'),{className:'combo__none',textContent:'Aucun résultat'}));
    lb.hidden=false;inp.setAttribute('aria-expanded','true');mark(items.indexOf(inp.value))};
  const choose=v=>{inp.value=v;close();['input','change'].forEach(t=>inp.dispatchEvent(new Event(t,{bubbles:true})))};
  inp.addEventListener('focus',()=>open());
  inp.addEventListener('click',()=>{lb.hidden&&open()});
  inp.addEventListener('input',e=>{e.isTrusted&&open()});
  inp.addEventListener('keydown',e=>{const max=items.length-1;
    if(e.key==='ArrowDown'){e.preventDefault();lb.hidden?open():mark(Math.min(act+1,max))}
    else if(e.key==='ArrowUp'){e.preventDefault();mark(Math.max(act-1,0))}
    else if(e.key==='Enter'&&!lb.hidden&&act>=0){e.preventDefault();choose(items[act])}
    else if(e.key==='Escape'&&!lb.hidden){e.preventDefault();e.stopPropagation();close()}});
  lb.addEventListener('mousedown',e=>{e.preventDefault();const li=e.target.closest('[role="option"]');li&&choose(li.textContent)});
  btn.addEventListener('mousedown',e=>{e.preventDefault();if(lb.hidden){inp.focus();open(true)}else close()});
  inp.addEventListener('blur',close);
});

/* 7. Menu mobile, choix de langue et menu profil : se ferment sur un lien, un clic ailleurs ou Échap */
const menus=[...d.querySelectorAll('details.mnav,details.langsel,details.pmenu')];
menus.forEach(m=>{
  m.addEventListener('click',e=>{e.target.closest('a')&&(m.open=false)});
  m.addEventListener('toggle',()=>{m.open&&menus.forEach(o=>o!==m&&(o.open=false))});
  m.addEventListener('focusout',e=>{e.relatedTarget&&!m.contains(e.relatedTarget)&&(m.open=false)});
});
d.addEventListener('click',e=>menus.forEach(m=>{m.open&&!m.contains(e.target)&&(m.open=false)}));
d.addEventListener('keydown',e=>{if(e.key!=='Escape')return;
  menus.forEach(m=>{if(m.open){m.open=false;m.querySelector('summary').focus()}})});
/* Confidentialité : réglages des cookies. Case « ne pas compter mes visites » (cookie mb_nostats, lu par le serveur)
   et effacement des réglages gardés dans le navigateur. Sans JS le bloc reste caché : le texte suffit. */
const cp=d.querySelector('[data-cookie-prefs]');
if(cp){
  cp.hidden=false;
  const box=cp.querySelector('[data-nostats]'),st=cp.querySelector('.cookie-prefs__status');
  box.checked=/(?:^|;\s*)mb_nostats=1(?:;|$)/.test(d.cookie);
  box.addEventListener('change',()=>{
    d.cookie='mb_nostats=1; Path=/; SameSite=Lax; Max-Age='+(box.checked?31536000:0)+(location.protocol==='https:'?'; Secure':'');
    st.textContent=box.checked?cp.dataset.off:cp.dataset.on});
  cp.querySelector('[data-prefs-reset]').addEventListener('click',()=>{
    try{localStorage.removeItem('mb-theme');localStorage.removeItem('mb-motion')}catch(e){}
    st.textContent=cp.dataset.reset;setTimeout(()=>location.reload(),900)});
}
})();
