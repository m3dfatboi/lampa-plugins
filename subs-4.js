/* subs-stable (auto-detect, OpenSubtitles v3)
   - Автоопределение текущего тайтла (IMDb/тип/S-E) из Lampa
   - Список RU субтитров + панель настроек (размер, отступ снизу, задержка ±0.5s)
   - Фиксированный отступ снизу через transform (Chrome/macOS)
*/
(function () {
  const FLAG='__SUBS_STABLE_AUTO_v2__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign({
    fontSize: 18,
    bottom: 48,
    delay: 0,
    selectedName: ''
  }, JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  let modalOpen=false, lastTrackUrl='', videoObs=null, cueShifted=false;

  async function GET(path,q){
    const u=new URL(path.replace(/^\//,''), OSV3_BASE);
    if(q) Object.keys(q).forEach(k=>{const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k,String(v));});
    const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  function pickRu(d){
    const a=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[];
    for(const s of a){
      const l=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url) continue;
      if(l==='ru'||l==='rus'||l==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }
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

  // ---- meta detection
  function parseTitleGuess(titleRaw){
    const title = safe(titleRaw);
    const se = title.match(/S(\d{1,2})E(\d{1,2})/i) || title.match(/(\d{1,2})x(\d{1,2})/);
    const year = (title.match(/\((\d{4})\)/)||[])[1] || (title.match(/\b(19|20)\d{2}\b/)||[])[0] || '';
    return {
      title: title.replace(/\((?:19|20)\d{2}\)/,'').replace(/S\d{1,2}E\d{1,2}/i,'').trim(),
      year: year?+year:'',
      season: se ? +se[1] : 0,
      episode: se ? +se[2] : 0
    };
  }
  function getContextMeta(){
    const ctx1 = (window.Lampa?.Player?.video && Lampa.Player.video()) || {};
    const ctx2 = (window.Lampa?.Activity?.active && Lampa.Activity.active()) || {};
    const ctx = Object.keys(ctx1).length?ctx1:ctx2;

    let imdbRaw = safe(ctx.imdb_id || ctx.imdb);
    imdbRaw = imdbRaw ? (imdbRaw.startsWith('tt')?imdbRaw:('tt'+imdbRaw.replace(/^tt/,''))) : '';

    let title = safe(ctx.title || ctx.name);
    let year  = ctx.year ? +ctx.year : (ctx.release_year ? +ctx.release_year : '');
    let season = Number.isFinite(+ctx.season)?+ctx.season:0;
    let episode= Number.isFinite(+ctx.episode)?+ctx.episode:0;

    if(!title || (!year && (!season||!episode))){
      const g = parseTitleGuess(safe(document.title));
      title = title || g.title;
      year = year || g.year;
      if(!season && !episode){ season=g.season; episode=g.episode; }
    }
    const type = season&&episode ? 'series' : 'movie';
    return { meta:{title, year, season, episode, imdb_id: imdbRaw}, type };
  }

  async function fetchAutoSubs(){
    const {meta, type} = getContextMeta();
    const tries=[];

    if (meta.imdb_id){
      tries.push({p:`subtitles/${type}/${encodeURIComponent(meta.imdb_id)}.json`, q:{season:meta.season||'',episode:meta.episode||''}});
      if (type==='series' && meta.season && meta.episode)
        tries.push({p:`subtitles/${type}/${encodeURIComponent(`${meta.imdb_id}:${meta.season}:${meta.episode}`)}.json`, q:{}});
      tries.push({p:'subtitles.json', q:{type, id:meta.imdb_id, season:meta.season||'', episode:meta.episode||''}});
    }
    if (meta.title) {
      if (meta.year) tries.push({p:'subtitles.json', q:{type, query:`${meta.title} ${meta.year}`, season:meta.season||'', episode:meta.episode||''}});
      tries.push({p:'subtitles.json', q:{type, query:meta.title, season:meta.season||'', episode:meta.episode||''}});
    }

    let subs=[];
    for (const t of tries){
      try{
        const data=await GET(t.p,t.q);
        const ru=pickRu(data);
        if (ru.length){ subs=ru; break; }
      }catch{}
    }
    return subs;
  }

  // ---- styles (size + bottom)
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`
      video::-webkit-media-text-track-display { font-size:${cfg.fontSize}px !important; transform: translateY(-${cfg.bottom}px); }
      video::cue { font-size:${cfg.fontSize}px; }
      .subs-stable-bottom { padding-bottom:${cfg.bottom}px !important; }
    `;
  }

  function shiftTextTracksDelay(video){
    if(!video?.textTracks) return;
    cueShifted=false;
    try{
      for(const tt of video.textTracks){
        tt.mode = (tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled';
        const delta=cfg.delay||0; if (!delta) continue;
        const cues=tt.cues||[];
        for(let i=0;i<cues.length;i++){
          const c=cues[i];
          try{
            c.startTime = Math.max(0,c.startTime + delta);
            c.endTime   = Math.max(c.startTime+0.2,c.endTime + delta);
          }catch{
            try{
              const nc=new VTTCue(Math.max(0,c.startTime+delta), Math.max(0.2,c.endTime+delta), c.text);
              tt.removeCue(c); tt.addCue(nc);
            }catch{}
          }
        }
      }
      cueShifted=true;
    }catch{}
  }

  function applyToVideo(vttUrl){
    lastTrackUrl=vttUrl; cueShifted=false;
    const v=document.querySelector('video'); if(!v) return;

    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    ensureStyle();
    v.classList.add('subs-stable-bottom');

    const show=()=>{
      try{
        if(v.textTracks){
          for(const tt of v.textTracks){
            tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled';
          }
          shiftTextTracksDelay(v);
        }
      }catch{}
    };
    show();
    v.addEventListener('loadeddata',show,{once:true});
    v.addEventListener('play',show,{once:true});
    observeVideo();
  }

  function observeVideo(){
    if(videoObs){ videoObs.disconnect(); videoObs=null; }
    const v=document.querySelector('video'); if(!v) return;
    videoObs=new MutationObserver(()=>{ if(lastTrackUrl) applyToVideo(lastTrackUrl); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }

  // ---- modal UI
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;
    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(800px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div');
    body.style.cssText='padding:12px 16px;overflow:auto;';
    body.innerHTML=html;
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
    h.querySelector('#x').onclick=closeModal; w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });
    return {body};
  }
  function closeModal(){ const w=document.getElementById('subs-stable-modal'); if(w) w.remove(); modalOpen=false; }
  function renderList(c,items,onPick){
    const ul=document.createElement('div');
    items.forEach(it=>{
      const btn=document.createElement('button');
      btn.textContent=it.label;
      btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      btn.onmouseenter=()=>btn.style.background='#333';
      btn.onmouseleave=()=>btn.style.background='transparent';
      btn.onclick=()=>onPick(it);
      ul.appendChild(btn);
    });
    c.innerHTML=''; c.appendChild(ul);
  }

  function openAutoPanel(subs){
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Доступные субтитры (RU)</legend>
          <div id="subsList"></div>
        </fieldset>
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Текущий файл</legend>
          <div id="currentFile" style="font-size:13px;color:#ccc;">${cfg.selectedName?('Выбран: '+safe(cfg.selectedName)):'Файл не выбран'}</div>
        </fieldset>
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Настройки</legend>
          <div style="display:grid;gap:10px;grid-template-columns:repeat(3,1fr);">
            <label>Размер (px)
              <input id="fontSize" type="number" min="10" max="60" value="${cfg.fontSize}" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            </label>
            <label>Отступ снизу (px)
              <input id="bottom" type="number" min="0" max="300" value="${cfg.bottom}" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            </label>
            <label>Задержка (сек, шаг 0.5)
              <div style="display:flex;gap:6px;align-items:center;margin-top:6px;">
                <button id="delayMinus" style="background:#444;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;">−0.5</button>
                <input id="delay" type="number" step="0.5" value="${cfg.delay}" style="flex:1;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
                <button id="delayPlus" style="background:#444;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;">+0.5</button>
              </div>
            </label>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button id="applySettings" style="background:#555;border:0;color:#fff;border-radius:8px;padding:10px 14px;cursor:pointer;">Применить</button>
          </div>
        </fieldset>
      </div>
    `);

    renderList(body.querySelector('#subsList'),
      subs.map(s=>({label:s.name,url:s.url,name:s.name})),
      async (s)=>{
        try{
          cfg.selectedName = s.name||'';
          saveCfg();
          const vtt=await toVttUrl(s.url);
          applyToVideo(vtt);
          body.querySelector('#currentFile').textContent='Выбран: '+cfg.selectedName;
        }catch{ try{ window.Lampa?.Noty?.show && Lampa.Noty.show('Ошибка загрузки субтитров'); }catch{} }
      }
    );

    const applySettings=()=>{
      cfg.fontSize=Math.max(10,Math.min(60, +body.querySelector('#fontSize').value||cfg.fontSize));
      cfg.bottom=Math.max(0,Math.min(300, +body.querySelector('#bottom').value||cfg.bottom));
      cfg.delay=+(body.querySelector('#delay').value||0);
      saveCfg(); ensureStyle();
      if(lastTrackUrl){ const keep=lastTrackUrl; lastTrackUrl=''; applyToVideo(keep); }
    };
    body.querySelector('#applySettings').onclick=applySettings;
    body.querySelector('#delayMinus').onclick=()=>{ const v=parseFloat(body.querySelector('#delay').value||0)-0.5; body.querySelector('#delay').value=(Math.round(v*2)/2).toString(); };
    body.querySelector('#delayPlus').onclick =()=>{ const v=parseFloat(body.querySelector('#delay').value||0)+0.5; body.querySelector('#delay').value=(Math.round(v*2)/2).toString(); };
  }

  async function openAuto(){
    try{
      const subs = await fetchAutoSubs();
      if (!subs.length){ openModal('<div>Субтитры не найдены</div>'); return; }
      openAutoPanel(subs);
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

  function init(){ ensureButton(); ensureStyle(); observeVideo(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
