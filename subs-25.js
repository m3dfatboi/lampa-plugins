/* subs-stable (bulk fetch all episodes like Stremio OSv3; UI: pick episode -> apply; movies auto)
   Что делает:
   - При открытии сериала: массово опрашивает OSv3 по всем сериям (S=1..MAX_S, E=1..MAX_E)
     строгим форматом Stremio: GET /subtitles/series/{tt}.json?season=S&episode=E
     и собирает карту: { "SxE": [sub items RU...] }
   - После сканирования показывает список сезонов/серий, где реально есть RU субтитры, и внутри — выбор файла.
   - Для фильмов: авто-поиск как раньше.
   - Есть "Без субтитров", live-настройки (размер/отступ/задержка), точный bottom (snapToLines=false), ESC.
   - Кнопка в панели плеера рядом с дефолтной CC.
   Примечание:
   - Лимитируем сетевые запросы (конкурентность) и диапазон S/E, чтобы не DDOSить аддон.
   - Если imdb_id отсутствует — выводим предупреждение вверху окна.
*/
(function () {
  const FLAG='__SUBS_STABLE_BULK_OSV3_v1__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  // Диапазон сканирования (можно увеличить при необходимости)
  const MAX_S=20; // сезоны 1..20
  const MAX_E=40; // эпизоды 1..40
  const CONCURRENCY=6; // параллельных запросов к OSv3

  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0, selectedName:'', debug:false }, JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  const safe=v=>(v==null?'':String(v));
  const normImdb=x=>{ const s=safe(x).trim(); if(!s) return ''; return s.startsWith('tt')?s:('tt'+s.replace(/^tt/,'')); };

  let modalOpen=false, lastTrackUrl='', escBound=false, videoObs=null;

  // ---------- HTTP ----------
  async function httpGet(path, q){
    const base=OSV3_BASE.endsWith('/')?OSV3_BASE:OSV3_BASE+'/';
    const url=new URL(path.replace(/^\//,''), base);
    if(q) for(const k of Object.keys(q)){ const v=q[k]; if(v!==''&&v!=null) url.searchParams.set(k,String(v)); }
    const href=url.toString();
    const r=await fetch(href);
    if(!r.ok) throw new Error('HTTP '+r.status);
    return { json: await r.json(), href };
  }
  function pickRu(d){
    const arr = Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[];
    for(const s of arr){
      const lang=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url) continue;
      if(lang==='ru'||lang==='rus'||lang==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }

  // ---------- SRT->VTT ----------
  function srtToVtt(s){
    const t=safe(s).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }
  async function toVttUrl(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url); if(!r.ok) throw new Error('download');
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }

  // ---------- META ----------
  function imdbFromRating(){
    try{
      const act=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
      if (act?.movie?.imdb_id) return act.movie.imdb_id;
      if (act?.card?.imdb_id)  return act.card.imdb_id;
      const render = act?.activity?.render && act.activity.render();
      const n = render && (render.querySelector('[data-imdb], [data-imdb-id]'));
      const v = n?.getAttribute('data-imdb') || n?.getAttribute('data-imdb-id');
      if (v) return v;
    }catch{}
    return '';
  }
  function getContext(){
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    const imdb = normImdb(imdbFromRating() || ctx.imdb_id || ctx.imdb);
    const title=safe(ctx.title || ctx.name || '');
    const year = ctx.year ? +ctx.year : (ctx.release_year ? +ctx.release_year : '');
    return { imdb, title, year };
  }

  // ---------- APPLY ----------
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue { font-size:${cfg.fontSize}px; }`;
  }
  function setCueBottomForTrack(tt, video){
    const vh=video.getBoundingClientRect().height||720;
    const percent=Math.max(0, Math.min(100, 100 - (cfg.bottom / vh) * 100));
    const cues=tt.cues||[];
    for(let i=0;i<cues.length;i++){
      try{ cues[i].snapToLines=false; cues[i].line=percent; cues[i].align='center'; cues[i].position=50; cues[i].size=100; }catch{}
    }
  }
  function applyBottom(video){
    if(!video?.textTracks) return;
    for(const tt of video.textTracks) setCueBottomForTrack(tt, video);
  }
  function applyDelay(video){
    if(!video?.textTracks) return;
    const delta=cfg.delay||0; if(!delta) return;
    for(const tt of video.textTracks){
      const cues=tt.cues||[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i];
        try{ c.startTime=Math.max(0,c.startTime+delta); c.endTime=Math.max(c.startTime+0.2,c.endTime+delta); }
        catch{
          try{
            const nc=new VTTCue(Math.max(0,c.startTime+delta), Math.max(0.2,c.endTime+delta), c.text);
            nc.snapToLines=false; nc.line=c.line; nc.align=c.align; nc.position=c.position; nc.size=c.size;
            tt.removeCue(c); tt.addCue(nc);
          }catch{}
        }
      }
    }
  }
  function removeAllSubTracks(){
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
  }
  function applyToVideo(vttUrl){
    const v=document.querySelector('video'); if(!v) return;

    removeAllSubTracks();
    lastTrackUrl=vttUrl||'';
    if (!vttUrl) return;

    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    const show=()=>{
      try{
        if(v.textTracks){
          for(const tt of v.textTracks){ tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled'; }
          applyBottom(v); applyDelay(v);
        }
      }catch{}
    };
    ensureStyle(); show();
    v.addEventListener('loadeddata',show,{once:true});
    v.addEventListener('play',show,{once:true});

    if (videoObs){ videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ applyToVideo(lastTrackUrl); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }
  function liveReapply(){
    const v=document.querySelector('video'); if(!v) return;
    ensureStyle();
    if(v.textTracks){ for(const tt of v.textTracks){ tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled'; } }
    applyBottom(v);
    if (lastTrackUrl && Math.abs(cfg.delay)>1e-6){ const keep=lastTrackUrl; lastTrackUrl=''; applyToVideo(keep); }
  }

  // ---------- UI helpers ----------
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;
    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(980px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="subsStableClose" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;'; body.innerHTML=html;
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
    h.querySelector('#subsStableClose').onclick=closeModal;
    w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });

    if(!escBound){ escBound=true; window.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&modalOpen){ e.preventDefault(); e.stopPropagation(); closeModal(); }},true); }
    return {body};
  }
  function closeModal(){ const w=document.getElementById('subs-stable-modal'); if(w) w.remove(); modalOpen=false; }
  function settingsBlock(){
    return `
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Настройки (live)</legend>
        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
          <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rangeSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
          <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rangeBottom" type="range" min="0" max="300" step="2" value="${cfg.bottom}" style="width:100%;"></div>
          <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${cfg.delay.toFixed(1)}</span></label><input id="rangeDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay}" style="width:100%;"></div>
        </div>
      </fieldset>
    `;
  }
  function bindSliders(root){
    const sizeEl=root.querySelector('#rangeSize'), bottomEl=root.querySelector('#rangeBottom'), delayEl=root.querySelector('#rangeDelay');
    const valSize=root.querySelector('#valSize'), valBottom=root.querySelector('#valBottom'), valDelay=root.querySelector('#valDelay');
    sizeEl.addEventListener('input', ()=>{ cfg.fontSize=+sizeEl.value; valSize.textContent=cfg.fontSize+'px'; saveCfg(); ensureStyle(); liveReapply(); });
    bottomEl.addEventListener('input', ()=>{ cfg.bottom=+bottomEl.value; valBottom.textContent=cfg.bottom+'px'; saveCfg(); liveReapply(); });
    delayEl.addEventListener('input', ()=>{ cfg.delay=parseFloat(delayEl.value)||0; valDelay.textContent=cfg.delay.toFixed(1); saveCfg(); liveReapply(); });
  }

  // ---------- BULK FETCH ----------
  async function bulkFetchSeries(imdb){
    const tt=normImdb(imdb);
    if(!tt) return { map:new Map(), scanned:0 };

    // генерация заданий S/E
    const jobs=[];
    for(let s=1;s<=MAX_S;s++){
      for(let e=1;e<=MAX_E;e++){
        jobs.push({s,e});
      }
    }

    const map=new Map(); // key "SxE" -> [{name,url}, ...]
    let scanned=0;

    // пулы запросов
    async function worker(queue){
      while(queue.length){
        const {s,e}=queue.shift();
        try{
          const {json}=await httpGet(`subtitles/series/${encodeURIComponent(tt)}.json`, {season:s, episode:e});
          const ru=pickRu(json);
          if (ru.length){
            map.set(`${s}x${e}`, ru);
          }
        }catch{/* ignore single fail */}
        scanned++;
      }
    }

    // копируем задания и запускаем N воркеров
    const q=jobs.slice();
    const workers=[];
    for(let i=0;i<CONCURRENCY;i++) workers.push(worker(q));
    await Promise.all(workers);

    // если пусто — попытка быстрая: пробежаться только по s=1..MAX_S, e=1..5 fallback-роутом
    if (map.size===0){
      const alt=[];
      for(let s=1;s<=Math.min(5,MAX_S);s++){
        for(let e=1;e<=Math.min(5,MAX_E);e++){
          alt.push({s,e});
        }
      }
      async function worker2(queue){
        while(queue.length){
          const {s,e}=queue.shift();
          try{
            const {json}=await httpGet('subtitles.json', {type:'series', id:tt, season:s, episode:e});
            const ru=pickRu(json);
            if (ru.length) map.set(`${s}x${e}`, ru);
          }catch{}
        }
      }
      const q2=alt.slice(); const ws=[];
      for(let i=0;i<CONCURRENCY;i++) ws.push(worker2(q2));
      await Promise.all(ws);
    }

    return { map, scanned };
  }

  // ---------- PANELS ----------
  async function openSeriesBulkPanel(meta){
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Сканирование эпизодов</legend>
          <div id="scanStatus" style="color:#bbb;">Подготовка...</div>
        </fieldset>

        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Найденные серии</legend>
          <div id="episodesList">Еще ничего нет. Подождите завершения сканирования...</div>
        </fieldset>

        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Файлы субтитров (выбранная серия)</legend>
          <div id="subsList">Выберите серию слева.</div>
        </fieldset>

        ${settingsBlock()}
      </div>
    `);

    bindSliders(body);

    if(!meta.imdb){
      body.querySelector('#scanStatus').innerHTML='<span style="color:#f78;">IMDb ID не найден. Откройте экран рейтингов, чтобы подтянуть imdb_id.</span>';
      return;
    }

    body.querySelector('#scanStatus').textContent='Сканирование OSv3...';

    // bulk fetch
    const { map } = await bulkFetchSeries(meta.imdb);

    if (!map.size){
      body.querySelector('#scanStatus').innerHTML='Сканирование завершено: подходящих RU субтитров не найдено.';
      return;
    }
    body.querySelector('#scanStatus').textContent=`Готово: найдено серий с субтитрами — ${map.size}`;

    // построение списка серий по сезонам
    const bySeason=new Map();
    for(const key of map.keys()){
      const [s,e]=key.split('x').map(n=>+n);
      if(!bySeason.has(s)) bySeason.set(s, []);
      bySeason.get(s).push(e);
    }
    for(const s of bySeason.keys()){
      bySeason.get(s).sort((a,b)=>a-b);
    }

    const epRoot=body.querySelector('#episodesList');
    epRoot.innerHTML='';
    for(const s of Array.from(bySeason.keys()).sort((a,b)=>a-b)){
      const head=document.createElement('div');
      head.textContent='Сезон '+s;
      head.style.cssText='margin:6px 0 4px;color:#bbb;font-weight:600;';
      epRoot.appendChild(head);
      const wrap=document.createElement('div');
      wrap.style.cssText='display:flex;flex-wrap:wrap;gap:6px;';
      bySeason.get(s).forEach(e=>{
        const b=document.createElement('button');
        b.textContent=`S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
        b.style.cssText='padding:6px 10px;background:#222;color:#fff;border:1px solid #444;border-radius:8px;cursor:pointer;';
        b.onmouseenter=()=>b.style.background='#333';
        b.onmouseleave=()=>b.style.background='#222';
        b.onclick=()=>renderSubsFor(s,e);
        wrap.appendChild(b);
      });
      epRoot.appendChild(wrap);
    }

    async function renderSubsFor(s,e){
      const list=body.querySelector('#subsList');
      const arr=map.get(`${s}x${e}`)||[];
      if (!arr.length){ list.textContent='Для выбранной серии нет субтитров'; return; }
      const items=[{label:'Без субтитров', url:'', name:'(off)'}].concat(arr.map(x=>({label:x.name,url:x.url,name:x.name})));
      // рендер
      const ul=document.createElement('div'); list.innerHTML=''; list.appendChild(ul);
      items.forEach(it=>{
        const btn=document.createElement('button');
        btn.textContent=it.label;
        btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
        btn.onmouseenter=()=>btn.style.background='#333';
        btn.onmouseleave=()=>btn.style.background='transparent';
        btn.onclick=async ()=>{
          try{
            cfg.selectedName=it.name||''; saveCfg();
            if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); }
            else { lastTrackUrl=''; removeAllSubTracks(); }
          }catch{}
        };
        ul.appendChild(btn);
      });
    }
  }

  // ---------- Movies (auto) ----------
  async function openMoviePanel(meta){
    // авто-поиск
    const items=[];
    const tt=normImdb(meta.imdb);
    if (tt){
      try{
        const {json}=await httpGet(`subtitles/movie/${encodeURIComponent(tt)}.json`,{});
        items.push(...pickRu(json));
      }catch{}
      if(!items.length){
        try{
          const {json}=await httpGet('subtitles.json',{type:'movie', id:tt});
          items.push(...pickRu(json));
        }catch{}
      }
    }
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
          <div id="subsList">${items.length?'':'Субтитры не найдены'}</div>
        </fieldset>
        ${settingsBlock()}
      </div>
    `);
    bindSliders(body);

    if (items.length){
      const list=body.querySelector('#subsList');
      const all=[{label:'Без субтитров', url:'', name:'(off)'}].concat(items.map(x=>({label:x.name,url:x.url,name:x.name})));
      const ul=document.createElement('div'); list.innerHTML=''; list.appendChild(ul);
      all.forEach(it=>{
        const btn=document.createElement('button');
        btn.textContent=it.label;
        btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
        btn.onmouseenter=()=>btn.style.background='#333';
        btn.onmouseleave=()=>btn.style.background='transparent';
        btn.onclick=async ()=>{
          try{
            cfg.selectedName=it.name||''; saveCfg();
            if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); }
            else { lastTrackUrl=''; removeAllSubTracks(); }
          }catch{}
        };
        ul.appendChild(btn);
      });
    }
  }

  // ---------- Open Auto ----------
  async function openAuto(){
    try{
      const meta=getContext();
      // Всегда открываем bulk-панель сериалов, как просили.
      await openSeriesBulkPanel(meta);
    }catch{
      openModal('<div>Ошибка открытия меню</div>');
    }
  }
  window.subsStableOpenAuto = openAuto;

  // ---------- Button inside player controls ----------
  (function(){
    const BTN_ID='subs-stable-btn-globe';
    function findControlsRight(){
      const cc=document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
      const host = cc ? cc.parentElement : (
        document.querySelector('.player-panel__right') ||
        document.querySelector('.player-controls__right') ||
        document.querySelector('.player-panel-controls-right') ||
        document.querySelector('.player-panel__controls') ||
        document.querySelector('.video-player__controls') ||
        document.querySelector('.player-panel') || null
      );
      return {host, cc};
    }
    function ensureButton(){
      const {host, cc}=findControlsRight(); if(!host) return false;
      let btn=document.getElementById(BTN_ID);
      if(!btn){
        btn = cc && cc.tagName==='BUTTON' ? cc.cloneNode(true) : document.createElement('button');
        btn.id=BTN_ID; btn.type='button'; btn.setAttribute('aria-label','subs-stable'); btn.setAttribute('title','subs-stable');
        if (cc && cc.className) btn.className = cc.className + ' subs-stable-btn';
        if (document.querySelector('.material-icons, .material-symbols-outlined') || document.querySelector('link[href*="fonts.googleapis.com/icon"]')){
          const i=document.createElement('span'); i.className='material-icons'; i.style.fontSize='20px'; i.textContent='public'; btn.innerHTML=''; btn.appendChild(i);
        } else if (document.querySelector('.mdi') || document.querySelector('link[href*="materialdesignicons"]')){
          const i=document.createElement('i'); i.className='mdi mdi-earth'; i.style.fontSize='20px'; btn.innerHTML=''; btn.appendChild(i);
        } else if (document.querySelector('.uil') || document.querySelector('link[href*="unicons"]')){
          const i=document.createElement('i'); i.className='uil uil-globe'; i.style.fontSize='20px'; btn.innerHTML=''; btn.appendChild(i);
        } else { btn.textContent='CC'; }
        btn.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); try{ window.subsStableOpenAuto && window.subsStableOpenAuto(); }catch{} });
        if (cc && cc.parentElement===host) cc.insertAdjacentElement('afterend', btn); else host.appendChild(btn);
      }
      return true;
    }
    const obs=new MutationObserver(()=>{ ensureButton(); });
    obs.observe(document.documentElement,{childList:true,subtree:true});
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>ensureButton(), {once:true}); else ensureButton();
    setTimeout(()=>ensureButton(), 400); setTimeout(()=>ensureButton(), 1200);
  })();

  // ---------- Init ----------
  function init(){ ensureStyle(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
