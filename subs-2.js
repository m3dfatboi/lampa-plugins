/* subs-stable: OpenSubtitles v3 (standalone, HTML5 track)
   + UI: show selected file
   + subtitle settings: font size, bottom margin, delay (±0.5s step)
   + search by IMDb ID, English and Russian titles
*/
(function(){
  const FLAG='__SUBS_STABLE__';
  if(window[FLAG])return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  // persistent settings
  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign({
    fontSize: 18,          // px
    bottom: 48,            // px
    delay: 0,              // seconds (can be negative)
    selectedName: '',
  }, JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));

  // helpers
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
    const out=[]; for(const s of a){
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

  // apply styles (font size, bottom margin)
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`
      video::-webkit-media-text-track-display { font-size:${cfg.fontSize}px !important; }
      video::cue { font-size:${cfg.fontSize}px; }
      .subs-stable-bottom{ bottom:${cfg.bottom}px !important; }
    `;
  }

  // Shift cues by cfg.delay seconds
  function shiftTextTracksDelay(video){
    if(!video || !video.textTracks) return;
    // prevent double-shift for same track load
    if(cueShifted) return;
    try{
      for(const tt of video.textTracks){
        // show RU only
        tt.mode = (tt.language==='ru'||/ru|рус/i.test(tt.label))?'showing':'disabled';
        // shift cues
        const delta=cfg.delay;
        if (!delta) continue;
        const cues=tt.cues||[];
        for(let i=0;i<cues.length;i++){
          const c=cues[i];
          // Some browsers forbid writing to cues in VTT linked by URL.
          // Create replacement VTTCues if writable fails.
          try{
            c.startTime = Math.max(0,c.startTime + delta);
            c.endTime   = Math.max(c.startTime+0.2,c.endTime + delta);
          }catch{
            try{
              const nc=new VTTCue(Math.max(0,c.startTime+delta), Math.max(0.2,c.endTime+delta), c.text);
              nc.align=c.align; nc.line=c.line; nc.position=c.position; nc.size=c.size; nc.vertical=c.vertical;
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

    // remove existing tracks
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());

    // track element
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    // style and bottom margin
    ensureStyle();
    v.classList.add('subs-stable-bottom');

    const show=()=>{
      try{
        if(v.textTracks){
          for(const tt of v.textTracks){
            tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled';
          }
          // apply delay
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

  // modal
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;

    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(760px,95vw);max-height:88vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div');
    body.style.cssText='padding:12px 16px;overflow:auto;';
    body.innerHTML=html;

    ['keydown','keypress','keyup'].forEach(t=>body.addEventListener(t,e=>e.stopPropagation(),true));
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
    h.querySelector('#x').onclick=closeModal; w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });

    const first=body.querySelector('input,textarea,select'); if(first){ first.focus(); first.select?.(); }
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

  // UI: Search form + selected file + settings
  function stepInput(def,onNext){
    const {body}=openModal(`
      <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr;">
        <fieldset style="grid-column:1/-1;border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Поиск</legend>
          <div style="display:grid;gap:8px;grid-template-columns:1fr 1fr 1fr 1fr;">
            <label style="grid-column:1/-1;">Название (EN/RU) или IMDb ID (tt1234567)
              <input id="q" type="text" placeholder="например: Dune 2024 / Дюна 2024 / tt1160419" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            </label>
            <label>Тип
              <select id="type" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
                <option value="movie">Фильм</option><option value="series">Сериал</option>
              </select>
            </label>
            <label>Год
              <input id="year" type="number" min="1900" max="2100" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            </label>
            <label>Сезон
              <input id="season" type="number" min="1" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            </label>
            <label>Эпизод
              <input id="episode" type="number" min="1" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            </label>
          </div>
        </fieldset>

        <fieldset style="grid-column:1/-1;border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Текущий файл</legend>
          <div id="currentFile" style="font-size:13px;color:#ccc;">${cfg.selectedName?('Выбран: '+safe(cfg.selectedName)):'Файл не выбран'}</div>
        </fieldset>

        <fieldset style="grid-column:1/-1;border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Настройки субтитров</legend>
          <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr 1fr;">
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
        </fieldset>

        <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;">
          <button id="applySettings" style="background:#555;border:0;color:#fff;border-radius:8px;padding:10px 14px;cursor:pointer;">Применить настройки</button>
          <button id="next" style="background:#0a84ff;border:0;color:#fff;border-radius:8px;padding:10px 14px;cursor:pointer;">Найти</button>
        </div>
      </div>
    `);

    // defaults
    body.querySelector('#q').value=def.query||'';
    body.querySelector('#type').value=def.type||'movie';
    body.querySelector('#year').value=def.year||'';
    body.querySelector('#season').value=def.season||'';
    body.querySelector('#episode').value=def.episode||'';

    // settings handlers
    const applySettings=()=>{
      cfg.fontSize=Math.max(10,Math.min(60, +body.querySelector('#fontSize').value||cfg.fontSize));
      cfg.bottom=Math.max(0,Math.min(300, +body.querySelector('#bottom').value||cfg.bottom));
      cfg.delay=+(body.querySelector('#delay').value||0);
      saveCfg(); ensureStyle();
      // reapply shift (reload track)
      if(lastTrackUrl){ const keep=lastTrackUrl; lastTrackUrl=''; applyToVideo(keep); }
    };
    body.querySelector('#applySettings').onclick=applySettings;
    body.querySelector('#delayMinus').onclick=()=>{ const v=parseFloat(body.querySelector('#delay').value||0)-0.5; body.querySelector('#delay').value=(Math.round(v*2)/2).toString(); };
    body.querySelector('#delayPlus').onclick =()=>{ const v=parseFloat(body.querySelector('#delay').value||0)+0.5; body.querySelector('#delay').value=(Math.round(v*2)/2).toString(); };

    // search
    body.querySelector('#next').onclick=()=>{
      const data={
        query: safe(body.querySelector('#q').value).trim(),
        type: body.querySelector('#type').value,
        year: body.querySelector('#year').value,
        season: Number(body.querySelector('#season').value)||'',
        episode: Number(body.querySelector('#episode').value)||'',
      };
      applySettings();
      closeModal();
      stepPickTitle(data, pick=> stepPickSubs(pick, async (chosen)=>{
        cfg.selectedName = chosen.name || '';
        saveCfg();
        const vtt=await toVttUrl(chosen.url);
        applyToVideo(vtt);
      }));
    };
  }

  // Title selection with EN/RU search:
  async function stepPickTitle(d,onNext){
    const isTT=/^tt\d+$/i.test(d.query);
    const langs = ['','&searchLanguage=eng','&searchLanguage=rus']; // try neutral, EN, RU
    let items=[];

    if(isTT){
      items=[{label:`IMDb ${d.query}${d.type==='series'&&d.season&&d.episode?` S${d.season}E${d.episode}`:''}`, id:d.query, type:d.type, season:d.season||'', episode:d.episode||''}];
    } else {
      // query-based catalog search (multi-language attempts)
      for(const l of langs){
        try{
          const urlParam = d.query ? `${d.query}${d.year?(' '+d.year):''}` : '';
          const cat = await GET('catalog.json',{ type:d.type, search:urlParam });
          const arr=Array.isArray(cat)?cat:(Array.isArray(cat.metas)?cat.metas:[]);
          const batch = arr.slice(0,50).map(x=>{
            const name=[x.name||x.title, x.year||''].filter(Boolean).join(' ');
            const id=x.id||x.imdb_id||x.imdb||'';
            return id?{label:`${name} (${id})`, id, type:d.type, season:d.season||'', episode:d.episode||''}:null;
          }).filter(Boolean);
          items = items.concat(batch);
        }catch{}
      }
      // unique by id
      const seen=new Set(); items=items.filter(x=>!seen.has(x.id)&&(seen.add(x.id),true));
      if(!items.length){
        // fallback: free-text entry
        items=[{label:`${d.query} ${d.year||''}`.trim(), id:'', q:d.query, type:d.type, season:d.season||'', episode:d.episode||''}];
      }
    }

    const {body}=openModal('<div id="list"></div>');
    renderList(body.querySelector('#list'), items, it=>{ closeModal(); onNext(it); });
  }

  // Sub selection
  async function stepPickSubs(p,onPick){
    const tries=[];
    if(p.id){
      tries.push({p:`subtitles/${p.type}/${encodeURIComponent(p.id)}.json`, q:{season:p.season||'',episode:p.episode||''}});
      if(p.type==='series'&&p.season&&p.episode) tries.push({p:`subtitles/${p.type}/${encodeURIComponent(`${p.id}:${p.season}:${p.episode}`)}.json`, q:{}});
      tries.push({p:'subtitles.json', q:{type:p.type, id:p.id, season:p.season||'', episode:p.episode||''}});
    } else if (p.q){
      tries.push({p:'subtitles.json', q:{type:p.type, query:p.q, season:p.season||'', episode:p.episode||''}});
    }
    let subs=[];
    for(const t of tries){
      try{ const data=await GET(t.p,t.q); const ru=pickRu(data); if(ru.length){ subs=ru; break; } }catch{}
    }
    if(!subs.length){ openModal('<div>Субтитры не найдены</div>'); return; }
    const {body}=openModal('<div id="list"></div>');
    renderList(body.querySelector('#list'), subs.map(s=>({label:s.name,url:s.url,name:s.name})), s=>{ closeModal(); onPick(s); });
  }

  // CC Button
  function ensureButton(){
    if(document.getElementById('subs-stable-btn')) return;
    const b=document.createElement('button');
    b.id='subs-stable-btn'; b.textContent='CC'; b.title=LABEL;
    b.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
    b.onmouseenter=()=>b.style.opacity='1'; b.onmouseleave=()=>b.style.opacity='.9';
    b.onclick=()=>{ if(modalOpen) closeModal(); else stepInput({type:'movie'},()=>{}); };
    document.body.appendChild(b);
  }

  function init(){ ensureButton(); ensureStyle(); observeVideo(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
