/* subs-stable (auto, OSv3, series picker without scanning)
   - Для сериалов: селекторы Сезон/Серия (без сканирования), мгновенная подгрузка RU субтитров для выбранной S/E
   - Сохраняет: ESC, "Без субтитров", live-настройки (размер/отступ/задержка), точный bottom (snapToLines=false)
*/
(function () {
  const FLAG='__SUBS_STABLE_SERIES_SELECT__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0, selectedName:'' }, JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  let modalOpen=false, lastTrackUrl='', videoObs=null, escBound=false;

  async function GET(path,q){
    const u=new URL(path.replace(/^\//,''), OSV3_BASE);
    if(q) Object.keys(q).forEach(k=>{const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k,String(v));});
    const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  function pickRu(d){
    const a=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[]; for(const s of a){
      const l=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href; if(!url) continue;
      if(l==='ru'||l==='rus'||l==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }
  function srtToVtt(s){
    const t=safe(s).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t.replace(/^\d+\n/gm,'').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4').replace(/\n{3,}/g,'\n\n');
  }
  async function toVttUrl(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url); if(!r.ok) throw new Error('download');
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }

  // ---- meta
  function normImdb(x){ const s=safe(x); return s? (s.startsWith('tt')?s:('tt'+s.replace(/^tt/,''))):''; }
  function imdbFromRating(){
    try{
      const act = (window.Lampa?.Activity?.active && Lampa.Activity.active()) || {};
      if (act?.movie?.imdb_id) return normImdb(act.movie.imdb_id);
      if (act?.card?.imdb_id)  return normImdb(act.card.imdb_id);
      const render = act?.activity?.render && act.activity.render();
      const n = render && (render.querySelector('[data-imdb], [data-imdb-id]'));
      const v = n?.getAttribute('data-imdb') || n?.getAttribute('data-imdb-id');
      if (v) return normImdb(v);
    }catch{}
    return '';
  }
  function parseTitleGuess(titleRaw){
    const title = safe(titleRaw);
    const se = title.match(/S(\d{1,2})E(\d{1,2})/i) || title.match(/(\d{1,2})x(\d{1,2})/);
    const year = (title.match(/\((\d{4})\)/)||[])[1] || (title.match(/\b(19|20)\d{2}\b/)||[]) || '';
    return { title: title.replace(/\((?:19|20)\d{2}\)/,'').replace(/S\d{1,2}E\d{1,2}/i,'').trim(), year: year?+year:'', season: se?+se[1]:0, episode: se?+se:0 };
  }
  function getMeta(){
    const ctx1 = (window.Lampa?.Player?.video && Lampa.Player.video()) || {};
    const ctx2 = (window.Lampa?.Activity?.active && Lampa.Activity.active()) || {};
    const ctx = Object.keys(ctx1).length?ctx1:ctx2;

    let imdb = imdbFromRating() || normImdb(ctx.imdb_id || ctx.imdb);
    let title = safe(ctx.title || ctx.name);
    let year  = ctx.year ? +ctx.year : (ctx.release_year ? +ctx.release_year : '');
    let season = Number.isFinite(+ctx.season)?+ctx.season:0;
    let episode= Number.isFinite(+ctx.episode)?+ctx.episode:0;

    if(!title || (!year && (!season||!episode))){
      const g = parseTitleGuess(safe(document.title));
      title = title || g.title; year = year || g.year;
      if(!season && !episode){ season=g.season; episode=g.episode; }
    }
    return { imdb, title, year, season, episode, type: (season&&episode)?'series':'movie' };
  }

  async function fetchSubsFor(m){
    const tries=[];
    if (m.imdb){
      tries.push({p:`subtitles/${m.type}/${encodeURIComponent(m.imdb)}.json`, q:{season:m.season||'', episode:m.episode||''}});
      if (m.type==='series' && m.season && m.episode)
        tries.push({p:`subtitles/${m.type}/${encodeURIComponent(`${m.imdb}:${m.season}:${m.episode}`)}.json`, q:{}});
      tries.push({p:'subtitles.json', q:{type:m.type, id:m.imdb, season:m.season||'', episode:m.episode||''}});
    }
    if (m.title){
      const q1 = m.year ? `${m.title} ${m.year}` : m.title;
      tries.push({p:'subtitles.json', q:{type:m.type, query:q1, season:m.season||'', episode:m.episode||''}});
    }
    let subs=[];
    for (const t of tries){
      try{ const data=await GET(t.p,t.q); const ru=pickRu(data); if(ru.length){ subs=ru; break; } }catch{}
    }
    return subs;
  }

  // ---- apply
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue { font-size:${cfg.fontSize}px; }`;
  }
  function setCueBottomForTrack(tt, video){
    const vh = video.getBoundingClientRect().height || 720;
    const percent = Math.max(0, Math.min(100, 100 - (cfg.bottom / vh) * 100));
    const cues = tt.cues || [];
    for (let i=0;i<cues.length;i++){
      const c = cues[i];
      try{
        c.snapToLines = false;
        c.line = percent;
        c.align = 'center';
        c.position = 50;
        c.size = 100;
      }catch{}
    }
  }
  function applyBottom(video){
    if(!video?.textTracks) return;
    for(const tt of video.textTracks) setCueBottomForTrack(tt, video);
  }
  function applyDelay(video){
    if(!video?.textTracks) return;
    const delta = cfg.delay||0; if (!delta) return;
    for(const tt of video.textTracks){
      const cues=tt.cues||[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i];
        try{
          c.startTime = Math.max(0,c.startTime + delta);
          c.endTime   = Math.max(c.startTime+0.2,c.endTime + delta);
        }catch{
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
    lastTrackUrl = vttUrl || '';
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
    if (videoObs) { videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ applyToVideo(lastTrackUrl); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }
  function liveReapply(){
    const v=document.querySelector('video'); if(!v) return;
    ensureStyle(); if(v.textTracks){ for(const tt of v.textTracks){ tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled'; } }
    applyBottom(v);
    if (lastTrackUrl && Math.abs(cfg.delay)>1e-6){ const keep=lastTrackUrl; lastTrackUrl=''; applyToVideo(keep); }
  }

  // ---- UI
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;
    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(880px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;'; body.innerHTML=html;
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
    h.querySelector('#x').onclick=closeModal; w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });
    if(!escBound){ escBound=true; window.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&modalOpen){ e.preventDefault(); e.stopPropagation(); closeModal(); }},true); }
    return {body};
  }
  function closeModal(){ const w=document.getElementById('subs-stable-modal'); if(w) w.remove(); modalOpen=false; }
  function renderList(c,items,onPick){
    const ul=document.createElement('div');
    items.forEach(it=>{
      const btn=document.createElement('button');
      btn.textContent=it.label;
      btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      btn.onmouseenter=()=>btn.style.background='#333'; btn.onmouseleave=()=>btn.style.background='transparent';
      btn.onclick=()=>onPick(it); ul.appendChild(btn);
    });
    c.innerHTML=''; c.appendChild(ul);
  }

  function buildSeriesSelector(season, episode){
    const sMax=30, eMax=60;
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;';
    wrap.innerHTML=`
      <label>Сезон:
        <select id="selSeason" style="margin-left:6px;padding:6px 10px;background:#111;color:#fff;border:1px solid #444;border-radius:8px;">
          ${Array.from({length:sMax},(_,i)=>i+1).map(v=>`<option value="${v}" ${v===season?'selected':''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Серия:
        <select id="selEpisode" style="margin-left:6px;padding:6px 10px;background:#111;color:#fff;border:1px solid #444;border-radius:8px;">
          ${Array.from({length:eMax},(_,i)=>i+1).map(v=>`<option value="${v}" ${v===episode?'selected':''}>${v}</option>`).join('')}
        </select>
      </label>
      <span id="seInfo" style="color:#bbb;">S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}</span>
    `;
    return wrap;
  }

  async function openSeriesPicker(imdb, initSeason, initEpisode, title, year){
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Серия</legend>
          <div id="sePick"></div>
        </fieldset>
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
          <div id="subsList"></div>
        </fieldset>
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Настройки (live)</legend>
          <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
            <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rangeSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
            <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rangeBottom" type="range" min="0" max="300" step="2" value="${cfg.bottom}" style="width:100%;"></div>
            <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${cfg.delay.toFixed(1)}</span></label><input id="rangeDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay}" style="width:100%;"></div>
          </div>
        </fieldset>
      </div>
    `);

    const seNode = buildSeriesSelector(initSeason||1, initEpisode||1);
    body.querySelector('#sePick').appendChild(seNode);

    const subsRoot = body.querySelector('#subsList');

    async function loadSubsForCurrent(){
      const s = +seNode.querySelector('#selSeason').value;
      const e = +seNode.querySelector('#selEpisode').value;
      seNode.querySelector('#seInfo').textContent = `S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;

      const subs = await fetchSubsFor({type:'series', imdb, season:s, episode:e, title, year});
      const items = [{label:'Без субтитров', url:'', name:'(off)'}].concat(subs.map(x=>({label:x.name,url:x.url,name:x.name})));
      renderList(subsRoot, items, async (it)=>{
        try{
          cfg.selectedName = it.name || ''; saveCfg();
          if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); }
          else { lastTrackUrl=''; removeAllSubTracks(); }
        }catch{ try{ window.Lampa?.Noty?.show && Lampa.Noty.show('Ошибка загрузки субтитров'); }catch{} }
      });
    }

    seNode.querySelector('#selSeason').addEventListener('change', loadSubsForCurrent);
    seNode.querySelector('#selEpisode').addEventListener('change', loadSubsForCurrent);

    // init load
    await loadSubsForCurrent();

    // sliders live
    const sizeEl=body.querySelector('#rangeSize'), bottomEl=body.querySelector('#rangeBottom'), delayEl=body.querySelector('#rangeDelay');
    const valSize=body.querySelector('#valSize'), valBottom=body.querySelector('#valBottom'), valDelay=body.querySelector('#valDelay');
    sizeEl.addEventListener('input', ()=>{ cfg.fontSize=+sizeEl.value; valSize.textContent=cfg.fontSize+'px'; saveCfg(); ensureStyle(); liveReapply(); });
    bottomEl.addEventListener('input', ()=>{ cfg.bottom=+bottomEl.value; valBottom.textContent=cfg.bottom+'px'; saveCfg(); liveReapply(); });
    delayEl.addEventListener('input', ()=>{ cfg.delay=parseFloat(delayEl.value)||0; valDelay.textContent=cfg.delay.toFixed(1); saveCfg(); liveReapply(); });
  }

  async function openAuto(){
    try{
      const m = getMeta();
      if (m.type==='series' && m.imdb){
        await openSeriesPicker(m.imdb, m.season||1, m.episode||1, m.title, m.year);
      } else {
        const subs = await fetchSubsFor(m);
        if (!subs.length){ openModal('<div>Субтитры не найдены</div>'); return; }
        // простая панель для фильмов
        const {body}=openModal(`
          <div style="display:grid;gap:12px;">
            <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
              <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
              <div id="subsList"></div>
            </fieldset>
            <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
              <legend style="padding:0 6px;color:#bbb;">Настройки (live)</legend>
              <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
                <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rangeSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
                <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rangeBottom" type="range" min="0" max="300" step="2" value="${cfg.bottom}" style="width:100%;"></div>
                <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${cfg.delay.toFixed(1)}</span></label><input id="rangeDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay}" style="width:100%;"></div>
              </div>
            </fieldset>
          </div>
        `);
        const items = [{label:'Без субтитров', url:'', name:'(off)'}].concat(subs.map(s=>({label:s.name,url:s.url,name:s.name})));
        renderList(body.querySelector('#subsList'), items, async (it)=>{
          try{
            cfg.selectedName=it.name||''; saveCfg();
            if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); }
            else { lastTrackUrl=''; removeAllSubTracks(); }
          }catch{}
        });
        const sizeEl=body.querySelector('#rangeSize'), bottomEl=body.querySelector('#rangeBottom'), delayEl=body.querySelector('#rangeDelay');
        const valSize=body.querySelector('#valSize'), valBottom=body.querySelector('#valBottom'), valDelay=body.querySelector('#valDelay');
        sizeEl.addEventListener('input', ()=>{ cfg.fontSize=+sizeEl.value; valSize.textContent=cfg.fontSize+'px'; saveCfg(); ensureStyle(); liveReapply(); });
        bottomEl.addEventListener('input', ()=>{ cfg.bottom=+bottomEl.value; valBottom.textContent=cfg.bottom+'px'; saveCfg(); liveReapply(); });
        delayEl.addEventListener('input', ()=>{ cfg.delay=parseFloat(delayEl.value)||0; valDelay.textContent=cfg.delay.toFixed(1); saveCfg(); liveReapply(); });
      }
    }catch{ openModal('<div>Ошибка поиска субтитров</div>'); }
  }

  function ensureButton(){
    if(document.getElementById('subs-stable-btn')) return;
    const b=document.createElement('button');
    b.id='subs-stable-btn'; b.textContent='CC'; b.title=LABEL;
    b.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
    b.onmouseenter=()=>b.style.opacity='1'; b.onmouseleave=()=>b.style.opacity='.9';
    b.onclick=()=>{ if(modalOpen) closeModal(); else openAuto(); };
    document.body.appendChild(b);
  }

  function init(){ ensureButton(); ensureStyle(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
