function injectButtonIntoPlayer() {
  const candidates = [
    '.player-panel__right',
    '.player-panel-controls-right',
    '.player-panel__controls',
    '.player-controls__right',
    '.video-player__controls',
    '.player-panel'
  ];
  let host=null;
  for (const sel of candidates) { const el=document.querySelector(sel); if (el) { host=el; break; } }
  if (!host) {
    const defCC = document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
    host = defCC ? defCC.parentElement : null;
  }
  if (!host) return false;

  // Если уже есть — обновим стиль и выходим
  let btn = host.querySelector('#subs-stable-btn-globe');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'subs-stable-btn-globe';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'subs-stable');
    btn.setAttribute('title', 'subs-stable');
    btn.setAttribute('tabindex', '0');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm7.938 9h-3.09c-.128-2.167-.764-4.15-1.77-5.67A8.01 8.01 0 0 1 19.938 11zM12 4c.86 0 2.349 1.73 2.89 5H9.11C9.651 5.73 11.14 4 12 4zM8.922 5.33C7.917 6.85 7.28 8.833 7.152 11h-3.09a8.01 8.01 0 0 1 4.86-5.67zM4.062 13h3.09c.128 2.167.765 4.15 1.77 5.67A8.01 8.01 0 0 1 4.062 13zM12 20c-.86 0-2.349-1.73-2.89-5h5.78C14.349 18.27 12.86 20 12 20zm3.078-1.33c1.005-1.52 1.642-3.503 1.77-5.67h3.09a8.01 8.01 0 0 1-4.86 5.67z"/>
      </svg>
    `;
    btn.addEventListener('click', ()=>{ try{ window.subsStableOpenAuto && window.subsStableOpenAuto(); }catch{} });
    host.appendChild(btn);
  }

  // Попытка 1: перенять классы у соседней дефолтной кнопки
  const near = host.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
  if (near) {
    // Скопируем класс-обёртку, если он отвечает за размеры/ховеры
    const cls = (near.className||'').trim();
    if (cls) btn.className = cls + ' subs-stable-btn-globe'; // добавим свой маркер

    // Попробуем унаследовать CSS-переменные/цвета
    btn.style.removeProperty('width');
    btn.style.removeProperty('height');
    btn.style.removeProperty('background');
    btn.style.removeProperty('border');
    btn.style.removeProperty('border-radius');
    btn.style.removeProperty('color');
    btn.style.removeProperty('opacity');
    btn.style.removeProperty('outline');

    // Если классы не влияют (или другая тема), аккуратно подгоним инлайном по computed styles
    const cs = window.getComputedStyle(near);
    const needInline =
      (!cs || !cs.width || cs.width === 'auto' || !cs.backgroundColor) ? true : false;

    if (needInline) {
      const w = cs.width || '40px';
      const h = cs.height || '40px';
      const br = cs.borderRadius || '8px';
      const bg = cs.backgroundColor || 'transparent';
      const bdw= cs.borderWidth || '0px';
      const bds= cs.borderStyle || 'solid';
      const bdc= cs.borderColor || 'transparent';
      const cur= cs.cursor || 'pointer';
      const opa= cs.opacity || '1';
      const trn= cs.transition || 'opacity .2s ease';

      Object.assign(btn.style, {
        width: w, height: h, background: bg, borderRadius: br,
        borderWidth: bdw, borderStyle: bds, borderColor: bdc,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: cur, opacity: opa, transition: trn, color: cs.color || '#fff',
        padding: cs.padding || '0', marginLeft: cs.marginLeft || '8px', outline: 'none'
      });

      btn.onmouseenter = ()=>{ btn.style.opacity='1'; };
      btn.onmouseleave = ()=>{ btn.style.opacity=opa; };
      btn.onfocus = ()=>{ btn.style.outline = cs.outline || '2px solid rgba(255,255,255,.6)'; };
      btn.onblur  = ()=>{ btn.style.outline = 'none'; };
    }
  } else {
    // Фолбэк, если рядом нет дефолтной CC
    Object.assign(btn.style, {
      width:'40px', height:'40px', background:'transparent', border:'0',
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      color:'#fff', opacity:'.9', cursor:'pointer', marginLeft:'8px'
    });
    btn.onmouseenter = ()=>btn.style.opacity='1';
    btn.onmouseleave = ()=>btn.style.opacity='.9';
  }

  // Обновлять при смене темы/DOM
  return true;
}
