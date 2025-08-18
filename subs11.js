(function () {
  const FLAG='__SUBS_RU_OSV3_MAC_CHROME__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='Субтитры (OpenSubtitles v3 · RU)';

  const safe=v=>(v==null?'':String(v));
  let modalOpen=false, lastTrackUrl='', videoObserver=null, keysBlocked=false;

  async function GET(path,q){
    const u=new URL(path.replace(/^\//,''), OSV3_BASE);
    if(q) Object.keys(q).forEach(k=>{ const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k,String(v)); });
    const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status); return r.json();
  }
  function pickRu(data){
    const a=Array.isArray(data)?data:(Array.isArray(data?.subtitles)?data.subtitles:[]);
    const out=[]; for(const s of a){ const l=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles'); const url=s.url||s.stream||s.href; if(!url) continue;
      if(l==='ru'||l==='rus'||l==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }
  function srtToVtt(s){ const t=safe(s).replace(/\r+/g,'').trim(); return 'WEBVTT\n\n'+t.replace(/^\d+\n/gm,'').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4').replace(/\n{3,}/g,'\n\n'); }
  async function toVttUrl(url){ if(/\.vtt(\?|$)/i.test(url)) return url; const r=await fetch(url); if(!r.ok) throw new Error('download');
    const b=await r.arrayBuffer(); let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b));}
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t); return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'})); }

  function applyTrackToVideo(video, url){
    if(!video) return;
    Array.from(video.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
    const tr=document.createElement('track'); tr.kind='subtitles'; tr.label='Русские'; tr.srclang='ru'; tr.src=url; tr.default=true; video.appendChild(tr);
    const show=()=>{ try{ if(video.textTracks){ for(const tt of video.textTracks){ tt.mode=(tt.language==='ru'||/ru|рус/i.test(tt.label))?'showing':'disabled'; } } }catch{} };
    show(); video.addEventListener('loadeddata',show,{once:true}); video.addEventListener('play',show,{once:true});
  }
  function observeVideo(){ if(videoObserver){videoObserver.disconnect();videoObserver=null;} const v=document.querySelector('video'); if(!v) return;
    videoObserver=new MutationObserver(()=>{ if(lastTrackUrl) applyTrackToVideo(v,lastTrackUrl); }); videoObserver.observe(v,{attributes:true,childList:true,subtree:true}); }
  function applyToPlayer(vtt){
    lastTrackUrl=vtt;
    const P=window.Lampa?.Player||window.Lampa?.PlayerVideo||window.Lampa?.PlayerLite||{}, S=P.subtitles;
    let ok=false; try{ if(S?.add){ S.clear&&S.clear(); S.add({label:'Русские',language:LANG,url:vtt}); S.enable&&S.enable(LANG); ok=true; } }catch{}
    try{ if(!ok&&window.Lampa?.Player?.listener?.send){ Lampa.Player.listener.send('subtitle',{label:'Русские',language:LANG,url:vtt}); ok=true; } }catch{}
    try{ if(!ok&&window.Lampa?.Event?.emit){ Lampa.Event.emit('player_subtitle',{url:vtt,label:'Русские',lang:LANG}); ok=true; } }catch{}
    applyTrackToVideo(document.querySelector('video'),vtt); observeVideo();
    window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
  }

  function blockGlobalKeys(){ if(keysBlocked) return; keysBlocked=true;
    window.addEventListener('keydown',stop,true); window.addEventListener('keypress',stop,true); window.addEventListener('keyup',stop,true);
    function stop(e){ e.stopImmediatePropagation(); }
  }
  function unblockGlobalKeys(){ if(!keysBlocked) return; keysBlocked=false;
    window.removeEventListener('keydown',null,true); window.removeEventListener('keypress',null,true); window.removeEventListener('keyup',null,true);
  }

  function openModal(html){
    if(modalOpen) closeModal(); modalOpen=true; blockGlobalKeys();
    const w=document.createElement('div'); w.id='subsru-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div'); b.style.cssText='width:min(720px,94vw);max-height:86vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div'); h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;'; body.innerHTML=html;
    ['keydown','keypress','keyup'].forEach(t=>body.addEventListener(t,e=>e.stopPropagation(),true));
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
