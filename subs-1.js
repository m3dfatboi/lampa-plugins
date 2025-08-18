(function(){
  const FLAG='__SUBS_RU_OSV3_STANDALONE__';
  if(window[FLAG])return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='Субтитры (OpenSubtitles v3 · RU)';

  const safe=v=>(v==null?'':String(v));
  let modalOpen=false, lastTrackUrl='', videoObs=null;

  async function GET(p,q){
    const u=new URL(p.replace(/^\//,''), OSV3_BASE);
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
    const seen=new Set();
    return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
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

  function applyToVideo(vttUrl){
    lastTrackUrl=vttUrl;
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    const show=()=>{
      try{
        if(v.textTracks){
          for(const tt of v.textTracks){
            tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled';
          }
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

  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;

    const w=document.createElement('div');
    w.id='subsru-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';

    const b=document.createElement('div');
    b.style.cssText='width:min(720px,94vw);max-height:86vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';

    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;

    const body=document.createElement('div');
    body.style.cssText='padding:12px 16px;overflow:auto;';
    body.innerHTML=html;

    ['keydown','keypress','keyup'].forEach(t=>body.addEventListener(t,e=>e.stopPropagation(),true));

    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);

    h.querySelector('#x').onclick=closeModal;
    w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });

    const first=body.querySelector('input,textarea,select'); if(first){ first.focus(); first.select?.(); }
    return {body};
  }

  function closeModal(){
    const w=document.getElementById('subsru-modal');
    if(w) w.remove();
    modalOpen=false;
  }

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

  function stepInput(def,onNext){
    const {body}=openModal(`
      <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr;">
        <label style="grid-column:1/-1;">Название или IMDb ID (tt1234567)
          <input id="q" type="text" placeholder="например: Dune 2024 или tt1160419" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;" autocomplete="off" autocapitalize="none" spellcheck="false">
        </label>
        <label>Тип
          <select id="type" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            <option value="movie">Фильм</option><option value="series">Сериал</option>
          </select>
        </label>
        <label>Год <input id="year" type="number" min="1900" max="2100" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;"></label>
        <label>Сезон <input id="season" type="number" min="1" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;"></label>
        <label>Эпизод <input id="episode" type="number" min="1" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;"></label>
        <div style="grid-column:1/-1;display:flex;justify-content:flex-end;margin-top:6px;">
          <button id="next" style="background:#0a84ff;border:0;color:#fff;border-radius:8px;padding:10px 14px;cursor:pointer;">Далее</button>
        </div>
      </div>`);
    body.querySelector('#q').value=def.query||'';
    body.querySelector('#type').value=def.type||'movie';
    body.querySelector('#year').value=def.year||'';
    body.querySelector('#season').value=def.season||'';
    body.querySelector('#episode').value=def.episode||'';
    body.querySelector('#next').onclick=()=>{
      const d={
        query: safe(body.querySelector('#q').value).trim(),
        type: body.querySelector('#type').value,
        year: body.querySelector('#year').value,
        season: Number(body.querySelector('#season').value)||'',
        episode: Number(body.querySelector('#episode').value)||''
      };
      closeModal();
      stepPickTitle(d,p=>stepPickSubs(p,applyChosen));
    };
  }

  async function stepPickTitle(d,onNext){
    const tt=/^tt\d+$/i.test(d.query)?d.query:'';
    let items=[];
    if(tt){
      items=[{label:`IMDb ${tt}${d.type==='series'&&d.season&&d.episode?` S${d.season}E${d.episode}`:''}`, id:tt, type:d.type, season:d.season||'', episode:d.episode||''}];
    }else{
      try{
        const cat=await GET('catalog.json',{type:d.type, search:d.query||(d.year?`${d.query} ${d.year}`:'')});
        const arr=Array.isArray(cat)?cat:(Array.isArray(cat.metas)?cat.metas:[]);
        items=arr.slice(0,50).map(x=>{
          const name=[x.name||x.title,x.year||''].filter(Boolean).join(' ');
          const id=x.id||x.imdb_id||x.imdb||'';
          return id?{label:`${name} (${id})`, id, type:d.type, season:d.season||'', episode:d.episode||''}:null;
        }).filter(Boolean);
      }catch{}
      if(!items.length){
        items=[{label:`${d.query} ${d.year||''}`.trim(), id:'', q:d.query, type:d.type, season:d.season||'', episode:d.episode||''}];
      }
    }
    const {body}=openModal('<div id="list"></div>');
    renderList(body.querySelector('#list'), items, it=>{ closeModal(); onNext(it); });
  }

  async function stepPickSubs(p,onApply){
    const tries=[];
    if(p.id){
      tries.push({p:`subtitles/${p.type}/${encodeURIComponent(p.id)}.json`, q:{season:p.season||'',episode:p.episode||''}});
      if(p.type==='series'&&p.season&&p.episode)
        tries.push({p:`subtitles/${p.type}/${encodeURIComponent(`${p.id}:${p.season}:${p.episode}`)}.json`, q:{}});
      tries.push({p:'subtitles.json', q:{type:p.type, id:p.id, season:p.season||'', episode:p.episode||''}});
    }else if(p.q){
      tries.push({p:'subtitles.json', q:{type:p.type, query:p.q, season:p.season||'', episode:p.episode||''}});
    }
    let subs=[];
    for(const t of tries){
      try{ const data=await GET(t.p,t.q); const ru=pickRu(data); if(ru.length){ subs=ru; break; } }catch{}
    }
    if(!subs.length){ openModal('<div>Субтитры не найдены</div>'); return; }
    const {body}=openModal('<div id="list"></div>');
    renderList(body.querySelector('#list'), subs.map(s=>({label:s.name,url:s.url})), s=>{ closeModal(); onApply(s.url); });
  }

  async function applyChosen(url){
    try{ const vtt=await toVttUrl(url); applyToVideo(vtt); }
    catch{ try{ window.Lampa?.Noty?.show && Lampa.Noty.show('Ошибка загрузки субтитров'); }catch{} }
  }

  function ensureButton(){
    if(document.getElementById('subsru-btn')) return;
    const b=document.createElement('button');
    b.id='subsru-btn'; b.textContent='CC'; b.title=LABEL;
    b.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
    b.onmouseenter=()=>b.style.opacity='1';
    b.onmouseleave=()=>b.style.opacity='.9';
    b.onclick=()=>{ if(modalOpen) closeModal(); else stepInput({type:'movie'},()=>{}); };
    document.body.appendChild(b);
  }

  function init(){ ensureButton(); observeVideo(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
