function injectButtonIntoPlayer() {
  const findHost = () => {
    const candidates = [
      '.player-panel__right',
      '.player-controls__right',
      '.player-panel-controls-right',
      '.player-panel__controls',
      '.video-player__controls',
      '.player-panel'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const def = document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
    return def ? def.parentElement : null;
  };

  const host = findHost();
  if (!host) return false;

  // Если уже добавлена — ничего не делаем
  if (host.querySelector('#subs-stable-btn-globe')) return true;

  // Пытаемся найти дефолтную кнопку субтитров, чтобы клонировать внешний вид
  const defCC = host.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');

  let btn;
  if (defCC && defCC.tagName === 'BUTTON') {
    // Клонируем кнопку (глубокая копия), чтобы унаследовать классы/стили/эффекты
    btn = defCC.cloneNode(true);
    // Чистим внутренности и ставим нашу иконку
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm7.938 9h-3.09c-.128-2.167-.764-4.15-1.77-5.67A8.01 8.01 0 0 1 19.938 11zM12 4c.86 0 2.349 1.73 2.89 5H9.11C9.651 5.73 11.14 4 12 4zM8.922 5.33C7.917 6.85 7.28 8.833 7.152 11h-3.09a8.01 8.01 0 0 1 4.86-5.67zM4.062 13h3.09c.128 2.167.765 4.15 1.77 5.67A8.01 8.01 0 0 1 4.062 13zM12 20c-.86 0-2.349-1.73-2.89-5h5.78C14.349 18.27 12.86 20 12 20zm3.078-1.33c1.005-1.52 1.642-3.503 1.77-5.67h3.09a8.01 8.01 0 0 1-4.86 5.67z"/>
      </svg>
    `;
    btn.id = 'subs-stable-btn-globe';
    btn.setAttribute('aria-label', 'subs-stable');
    btn.setAttribute('title', 'subs-stable');
    // Снимаем поведение дефолтной CC (некоторые билды вешают слушатели на потомков)
    const newBtn = btn.cloneNode(true);
    btn.replaceWith(newBtn);
    btn = newBtn;
  } else {
    // Fallback — создаём кнопку вручную, но похожую по виду
    btn = document.createElement('button');
    btn.id = 'subs-stable-btn-globe';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'subs-stable');
    btn.setAttribute('title', 'subs-stable');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm7.938 9h-3.09c-.128-2.167-.764-4.15-1.77-5.67A8.01 8.01 0 0 1 19.938 11zM12 4c.86 0 2.349 1.73 2.89 5H9.11C9.651 5.73 11.14 4 12 4zM8.922 5.33C7.917 6.85 7.28 8.833 7.152 11h-3.09a8.01 8.01 0 0 1 4.86-5.67zM4.062 13h3.09c.128 2.167.765 4.15 1.77 5.67A8.01 8.01 0 0 1 4.062 13zM12 20c-.86 0-2.349-1.73-2.89-5h5.78C14.349 18.27 12.86 20 12 20zm3.078-1.33c1.005-1.52 1.642-3.503 1.77-5.67h3.09a8.01 8.01 0 0 1-4.86 5.67z"/>
      </svg>
    `;
    // Пытаемся взять размеры у ближайшей кнопки
    const probe = host.querySelector('button') || host;
    const cs = window.getComputedStyle(probe);
    Object.assign(btn.style, {
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      width: cs.width && cs.width !== 'auto' ? cs.width : '40px',
      height: cs.height && cs.height !== 'auto' ? cs.height : '40px',
      background: 'transparent',
      border: '0',
      color: cs.color || '#fff',
      cursor: 'pointer',
      marginLeft: '8px',
      opacity: '.9',
      transition: 'opacity .2s ease'
    });
    btn.onmouseenter = ()=> btn.style.opacity='1';
    btn.onmouseleave = ()=> btn.style.opacity='.9';
  }

  // Навешиваем наш обработчик
  btn.addEventListener('click', ()=>{ try { window.subsStableOpenAuto && window.subsStableOpenAuto(); } catch {} });

  // Вставляем рядом с дефолтной CC или в конец правого блока
  if (defCC && defCC.parentElement === host) defCC.insertAdjacentElement('afterend', btn);
  else host.appendChild(btn);

  return true;
}

// Перестраховка: повторные попытки и наблюдатель DOM
if (!window.__SUBS_STABLE_BTN_OBS__) {
  window.__SUBS_STABLE_BTN_OBS__ = new MutationObserver(()=>{ try{ injectButtonIntoPlayer(); }catch{} });
  window.__SUBS_STABLE_BTN_OBS__.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', ()=>{ try{ injectButtonIntoPlayer(); }catch{} }, { once:true });
  setTimeout(()=>{ try{ injectButtonIntoPlayer(); }catch{} }, 300);
  setTimeout(()=>{ try{ injectButtonIntoPlayer(); }catch{} }, 1200);
  setTimeout(()=>{ try{ injectButtonIntoPlayer(); }catch{} }, 3000);
}
