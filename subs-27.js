/* subs-stable (OSv3, сериалы и фильмы)
   - Кнопка в панели плеера (рядом с дефолтной CC)
   - Сериалы: 2 режима
       • Ручной: ввести сезон/серию → строгий запрос Stremio OSv3
       • Массовый: сканирует диапазон серий и показывает где есть RU-сабы
   - Фильмы: авто-поиск
   - Настройки: размер, отступ снизу, задержка
*/
(function () {
  const FLAG='__SUBS_STABLE_OSV3_CLEAN__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  // Диапазон и параллелизм для bulk
  const MAX_S=12, MAX_E=30, CONC=6;

  const STORE='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0 }, JSON.parse(localStorage.getItem(STORE)||'{}'));
  const save=()=>localStorage.setItem(STORE, JSON.stringify(cfg));
  const S=s=>s==null?'':String(s);
  const normImdb=x=>{ const m=S(x).trim().match(/^tt\d+$/); return m?m[0]:'tt'+S(x).trim().replace(/^tt?/,'').replace(/\D.*$/,''); };

  // ======= HTTP / pick =======
  async function GET(path,q){
    const base=OSV3.endsWith('/')?OSV3:OSV3+'/';
    const u=new URL(path.replace(/^\//,''), base);
    if(q) Object.keys(q).forEach(k=>{ const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k,String(v)); });
    const r=await fetch(u.toString()); if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  function pickRU(d){
    const arr=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[];
    for(const s of arr){
      const lang=S(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=S(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url) continue;
      if(lang==='ru'||lang==='rus'||lang==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }
  function pickAll(d){
    const arr=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[]; const seen=new Set();
    for(const s of arr){
      const lang=S(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=S(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url||seen.has(url)) continue;
      seen.add(url); out.push({name,url,lang});
    }
    return out;
  }

  // ======= VTT / APPLY =======
  function srtToVtt(t){
    t=S(t).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t.replace(/^\d+\n/gm,'')
             .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
             .replace(/\n{3,}/g,'\n\n');
  }
  async function toVTT(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url); if(!r.ok) throw new Error('download');
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue{font-size:${cfg.fontSize}px}`;
  }
  function setBottom(v){
    if(!v?.textTracks) return;
    const vh=v.getBoundingClientRect().height||720;
    const percent=Math.max(0,Math.min(100,100 - (cfg.bottom/vh)*100));
    for(const tt of v.textTracks){
      const cues=tt.cues||[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i]; try{ c.snapToLines=false; c.line=percent; c.align='center'; c.position=50; c.size=100; }catch{}
      }
    }
  }
  async function applyTrack(url){
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
    if(!url) return;
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang='ru'; tr.src=await toVTT(url); tr.default=true;
    v.appendChild(tr);
    ensureStyle(); setBottom(v);
  }

  // ======= META =======
  function getMeta(){
    const a=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=a||{};
    const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    let imdb = a?.movie?.imdb_id || a?.card?.imdb_id || ctx.imdb_id || ctx.imdb || '';
    imdb = normImdb(imdb);
    const title=S(ctx.title||ctx.name||'');
    const year=ctx.year?+ctx.year:(ctx.release_year?+ctx.release_year:'');
    return { imdb, title, year };
  }

  // ======= MOVIE =======
  async function fetchMovie(meta){
    const out=[];
    if (meta.imdb){
      try{ out.push(...pickRU(await GET(`subtitles/movie/${encodeURIComponent(meta.imdb)}.json`,{}))); }catch{}
      if(!out.length){ try{ out.push(...pickRU(await GET('subtitles.json',{type:'movie',id:meta.imdb}))); }catch{} }
    } else if (meta.title){
      try{ out.push(...pickRU(await GET('subtitles.json',{type:'movie',query:meta.year?`${meta.title} ${meta.year}`:meta.title}))); }catch{}
    }
    return out;
  }

  // ======= SERIES (manual one) =======
  async function fetchSeriesOne(tt,s,e,all){
    try{
      const data=await GET(`subtitles/series/${encodeURIComponent(tt)}.json`,{season:s,episode:e});
      const list=all?pickAll(data):pickRU(data);
      if(list.length) return list;
    }catch{}
    try{
      const data=await GET('subtitles.json',{type:'series',id:tt,season:s,episode:e});
      return all?pickAll(data):pickRU(data);
    }catch{}
    return [];
  }

  // ======= SERIES (bulk) =======
  async function bulkSeries(tt){
    const map=new Map();
    const jobs=[];
    for(let s=1;s<=MAX_S;s++) for(let e=1;e<=MAX_E;e++) jobs.push({s,e});
    async function worker(q){
      while(q.length){
        const {s,e}=q.shift();
        try{
          const d=await GET(`subtitles/series/${encodeURIComponent(tt)}.json`,{season:s,episode:e});
          const ru=pickRU(d);
          if(ru.length) map.set(`${s}x${e}`,ru);
        }catch{}
      }
    }
    const q=jobs.slice(); const ws=[];
    for(let i=0;i<CONC;i++) ws.push(worker(q));
    await Promise.all(ws);
    if(!map.size){
      const alt=[]; for(let s=1;s<=Math.min(5,MAX_S);s++) for(let e=1;e<=Math.min(5,MAX_E);e++) alt.push({s,e});
      async function worker2(q2){
        while(q2.length){
          const {s,e}=q2.shift();
          try{
            const d=await GET('subtitles.json',{type:'series',id:tt,season:s,episode:e});
            const ru=pickRU(d); if(ru.length) map.set(`${s}x${e}`,ru);
          }catch{}
        }
      }
      const q2=alt.slice(); const ws2=[];
      for(let i=0;i<CONC;i++) ws2.push(worker2(q2));
      await Promise.all(ws2);
    }
    return map;
  }

  // ======= UI helpers =======
  function openModal(html){
    const id='subs-stable-modal';
    const old=document.getElementById(id); if(old) old.remove();
    const w=document.createElement('div'); w.id=id;
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(960px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:auto;padding:12px 16px;';
    b.innerHTML=html; w.appendChild(b); document.body.appendChild(w);
    w.addEventListener('click',e=>{ if(e.target===w) w.remove(); });
  }
  function listButtons(root, items, onPick){
    root.innerHTML=''; const box=document.createElement('div'); root.appendChild(box);
    items.forEach(it=>{
      const btn=document.createElement('button');
      btn.textContent=it.label;
      btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      btn.onmouseenter=()=>btn.style.background='#333';
      btn.onmouseleave=()=>btn.style.background='transparent';
      btn.onclick=()=>onPick(it);
      box.appendChild(btn);
    });
  }
  function settingsHTML(){
    return `
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
        <legend style="padding:0 6px;color:#bbb;">Настройки (live)</legend>
        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
          <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
          <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rBottom" type="range" min="0" max="300" step="2" value="${cfg.bottom}" style="width:100%;"></div>
          <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${cfg.delay.toFixed(1)}</span></label><input id="rDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay}" style="width:100%;"></div>
        </div>
      </fieldset>
    `;
  }
  function bindSettings(root){
    const rs=root.querySelector('#rSize'), rb=root.querySelector('#rBottom'), rd=root.querySelector('#rDelay');
    const vs=root.querySelector('#valSize'), vb=root.querySelector('#valBottom'), vd=root.querySelector('#valDelay');
    rs.oninput=()=>{ cfg.fontSize=+rs.value; vs.textContent=cfg.fontSize+'px'; save(); ensureStyle(); };
    rb.oninput=()=>{ cfg.bottom=+rb.value; vb.textContent=cfg.bottom+'px'; save(); const v=document.querySelector('video'); if(v) setBottom(v); };
    rd.oninput=()=>{ cfg.delay=parseFloat(rd.value)||0; vd.textContent=cfg.delay.toFixed(1); save(); };
  }

  // ======= Panels =======
  async function panelMovie(){
    const meta=getMeta();
    const subs=await fetchMovie(meta);
    openModal(`
      <h3 style="margin:0 0 8px 0;">${LABEL}</h3>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
        <div id="list">${subs.length?'':'Субтитры не найдены'}</div>
      </fieldset>
      ${settingsHTML()}
    `);
    const root=document.getElementById('list'); bindSettings(document.body);
    if(!subs.length) return;
    const items=[{label:'Без субтитров',url:''}].concat(subs.map(x=>({label:x.name,url:x.url})));
    listButtons(root, items, async it=>{ if(it.url) await applyTrack(it.url); else applyTrack(''); });
  }

  async function panelSeriesManual(){
    const meta=getMeta();
    openModal(`
      <h3 style="margin:0 0 8px 0;">${LABEL} — сериал (ручной)</h3>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Параметры</legend>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input id="imdb" placeholder="tt1234567" value="${meta.imdb||''}" style="flex:1;min-width:220px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
          <input id="season" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
          <input id="episode" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
          <button id="find" style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Найти (RU)</button>
          <button id="findAll" style="background:#222;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;">Все языки</button>
        </div>
      </fieldset>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
        <legend style="padding:0 6px;color:#bbb;">Результаты</legend>
        <div id="list">Укажите tt/S/E и нажмите “Найти”.</div>
      </fieldset>
      ${settingsHTML()}
    `);
    bindSettings(document.body);
    const q=(id)=>document.getElementById(id);

    async function run(all){
      const tt=normImdb(q('imdb').value), s=+q('season').value, e=+q('episode').value;
      const list=document.getElementById('list'); if(!tt||!s||!e){ list.textContent='Проверьте tt/S/E'; return; }
      list.textContent='Поиск...';
      const result=await fetchSeriesOne(tt,s,e,all);
      if(!result.length){ list.textContent='Субтитры не найдены'; return; }
      const items=[{label:'Без субтитров',url:''}].concat(result.map(x=>({label: all?`[${x.lang||'??'}] ${x.name}`:x.name, url:x.url})));
      listButtons(list, items, async it=>{ if(it.url) await applyTrack(it.url); else applyTrack(''); });
    }
    q('find').onclick   = ()=>run(false);
    q('findAll').onclick= ()=>run(true);
  }

  async function panelSeriesBulk(){
    const meta=getMeta(), tt=meta.imdb;
    openModal(`
      <h3 style="margin:0 0 8px 0;">${LABEL} — сериал (сканирование)</h3>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Сканирование</legend>
        <div id="scan">${tt?'Идёт сканирование...':'IMDb ID не найден (откройте экран рейтингов)'}</div>
      </fieldset>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
        <legend style="padding:0 6px;color:#bbb;">Серии</legend>
        <div id="eps">—</div>
      </fieldset>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
        <legend style="padding:0 6px;color:#bbb;">Файлы</legend>
        <div id="files">—</div>
      </fieldset>
      ${settingsHTML()}
    `);
    bindSettings(document.body);
    if(!tt) return;

    const map=await bulkSeries(tt);
    const scan=document.getElementById('scan');
    const eps=document.getElementById('eps');
    const files=document.getElementById('files');

    if(!map.size){ scan.textContent='Готово: RU субтитров не найдено.'; eps.textContent='—'; return; }
    scan.textContent=`Готово: серий с RU — ${map.size}`;

    const byS=new Map();
    for(const k of map.keys()){
      const [s,e]=k.split('x').map(n=>+n);
      if(!byS.has(s)) byS.set(s,[]);
      byS.get(s).push(e);
    }
    for(const s of byS.keys()) byS.get(s).sort((a,b)=>a-b);

    eps.innerHTML='';
    for(const s of Array.from(byS.keys()).sort((a,b)=>a-b)){
      const head=document.createElement('div'); head.textContent='Сезон '+s; head.style.cssText='margin:6px 0;color:#bbb;font-weight:600;'; eps.appendChild(head);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;';
      byS.get(s).forEach(e=>{
        const b=document.createElement('button');
        b.textContent=`S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
        b.style.cssText='padding:6px 10px;background:#222;color:#fff;border:1px solid #444;border-radius:8px;cursor:pointer;';
        b.onclick=()=>{
          const arr=map.get(`${s}x${e}`)||[];
          if(!arr.length){ files.textContent='—'; return; }
          const items=[{label:'Без субтитров',url:''}].concat(arr.map(x=>({label:x.name,url:x.url})));
          listButtons(files, items, async it=>{ if(it.url) await applyTrack(it.url); else applyTrack(''); });
        };
        row.appendChild(b);
      });
      eps.appendChild(row);
    }
  }

  // ======= Root launcher =======
  async function openRoot(){
    openModal(`
      <h3 style="margin:0 0 10px 0;">${LABEL}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <button id="bSeriesBulk"  style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Сериал: сканировать</button>
        <button id="bSeriesManual" style="background:#222;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;">Сериал: ручной</button>
        <button id="bMovie"       style="background:#222;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;">Фильм: авто</button>
      </div>
      <div id="panel"></div>
    `);
    document.getElementById('bSeriesBulk').onclick = ()=>panelSeriesBulk();
    document.getElementById('bSeriesManual').onclick= ()=>panelSeriesManual();
    document.getElementById('bMovie').onclick       = ()=>panelMovie();
    panelSeriesBulk();
  }
  window.subsStableOpenAuto=openRoot;

  // ======= Button in player controls =======
  (function(){
    const ID='subs-stable-btn';
    function host(){
      const cc=document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
      return cc?cc.parentElement:(
        document.querySelector('.player-panel__right')||
        document.querySelector('.player-controls__right')||
        document.querySelector('.player-panel-controls-right')||
        document.querySelector('.player-panel__controls')||
        document.querySelector('.video-player__controls')||
        document.querySelector('.player-panel')||null
      );
    }
    function ensure(){
      const h=host(); if(!h) return false;
      if(document.getElementById(ID)) return true;
      const b=document.createElement('button');
      b.id=ID; b.type='button'; b.title=LABEL;
      b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;background:transparent;border:0;color:#fff;opacity:.9;cursor:pointer;';
      b.innerHTML='<span style="font:600 14px/1 sans-serif;">CC</span>';
      b.onmouseenter=()=>b.style.opacity='1';
      b.onmouseleave=()=>b.style.opacity='.9';
      b.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); openRoot(); };
      h.appendChild(b);
      return true;
    }
    const mo=new MutationObserver(()=>ensure());
    mo.observe(document.documentElement,{childList:true,subtree:true});
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>ensure(), {once:true}); else ensure();
    setTimeout(()=>ensure(),400); setTimeout(()=>ensure(),1200);
  })();

  // ======= Init =======
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>ensureStyle(), {once:true}); else ensureStyle();
})();
