/* subs-stable: UI button fix (globe next to default CC, opens our menu, uses built-in icon font if present)
   - Places our button IMMEDIATELY after the default subtitles button
   - Reuses the same classes/styles as default control buttons
   - Uses icon font class if detected (material/mdi/lampa icons), else minimal SVG fallback
   - Guarantees click opens subs-stable menu (window.subsStableOpenAuto)
*/
(function(){
  // Replace the previous injectButtonIntoPlayer implementation with this one
  function injectButtonIntoPlayer() {
    const findHostAndCC = () => {
      // Default CC button candidates
      const ccSelectors = [
        'button[aria-label="Subtitles"]',
        'button[title="Subtitles"]',
        '.icon--subtitles',
        '.player__subtitles',
        'button[aria-label*="убтитр"]', // RU fallback
        'button[title*="убтитр"]'
      ];
      let cc=null;
      for (const s of ccSelectors) { const el = document.querySelector(s); if (el) { cc=el; break; } }
      const host = cc ? cc.parentElement : (
        document.querySelector('.player-panel__right') ||
        document.querySelector('.player-controls__right') ||
        document.querySelector('.player-panel-controls-right') ||
        document.querySelector('.player-panel__controls') ||
        document.querySelector('.video-player__controls') ||
        document.querySelector('.player-panel') ||
        null
      );
      return { host, cc };
    };

    const {host, cc} = findHostAndCC();
    if (!host) return false;

    // Remove old if misplaced
    const old = document.getElementById('subs-stable-btn-globe');
    if (old && old.parentElement !== host) old.remove();

    // If already exists and correctly placed next to CC, just ensure click handler
    let btn = document.getElementById('subs-stable-btn-globe');
    if (!btn) {
      // Create button by cloning default CC when possible to inherit classes and interaction states
      if (cc && cc.tagName === 'BUTTON') {
        btn = cc.cloneNode(true);
        // Clean inner content to replace icon
        btn.innerHTML = '';
      } else {
        btn = document.createElement('button');
      }
      btn.id = 'subs-stable-btn-globe';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'subs-stable');
      btn.setAttribute('title', 'subs-stable');

      // Try to reuse common control classes from CC to blend in
      if (cc && cc.className) {
        btn.className = cc.className + ' subs-stable-btn-globe';
      } else {
        // Minimal fallback if no classes available
        Object.assign(btn.style, {
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:'40px', height:'40px', background:'transparent', border:'0',
          color:'inherit', cursor:'pointer', marginLeft:'8px'
        });
      }

      // Pick an icon from common open libraries if present
      // 1) Material Icons (Google font)
      if (document.querySelector('link[href*="fonts.googleapis.com/icon"], .material-icons, .material-symbols-outlined')) {
        const i = document.createElement('span');
        i.className = 'material-icons';
        i.style.fontSize = '20px';
        i.textContent = 'public'; // globe
        btn.appendChild(i);
      }
      // 2) MDI (Material Design Icons)
      else if (document.querySelector('link[href*="materialdesignicons"], .mdi')) {
        const i = document.createElement('i');
        i.className = 'mdi mdi-earth';
        i.style.fontSize = '20px';
        btn.appendChild(i);
      }
      // 3) Unicons (user mentioned using Unicons in other projects)
      else if (document.querySelector('.uil') || document.querySelector('link[href*="unicons"]')) {
        const i = document.createElement('i');
        i.className = 'uil uil-globe';
        i.style.fontSize = '20px';
        btn.appendChild(i);
      }
      // 4) Fallback minimal SVG
      else {
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 100 20 10 10 0 000-20Zm7.1 9h-3.05a13.7 13.7 0 00-1.66-5.2A8 8 0 0119.1 11ZM9.6 5.8A12 12 0 008.07 11H4.9A8 8 0 019.6 5.8ZM4.9 13h3.17a12 12 0 001.53 5.2A8 8 0 014.9 13Zm5.48 0h3.24a10.8 10.8 0 01-1.62 4.52c-.55.95-1.1 1.48-1.62-2.2A12.3 12.3 0 0110.38 13Zm3.24-2h-3.24a12.3 12.3 0 011.62-4.32c.55-.95 1.1-1.48 1.62 2.2.28.82.48 1.73.62 2.12ZM12 4a8 8 0 013.61 1.87A13.7 13.7 0 0117.95 11h-3.05A12 12 0 0012 4Zm0 16a8 8 0 01-3.61-1.87A13.7 13.7 0 016.05 13h3.05A12 12 0 0012 20Z"/>
          </svg>
        `;
      }

      // Ensure click opens our menu
      btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); try{ window.subsStableOpenAuto && window.subsStableOpenAuto(); }catch{} });

      // Insert IMMEDIATELY after default CC if present, else append to right controls
      if (cc && cc.parentElement === host) cc.insertAdjacentElement('afterend', btn);
      else host.appendChild(btn);
    } else {
      // Ensure click handler still bound
      btn.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); try{ window.subsStableOpenAuto && window.subsStableOpenAuto(); }catch{} };
    }

    // Match computed sizes exactly to default CC if possible
    if (cc) {
      const cs = getComputedStyle(cc);
      if (cs) {
        ['width','height','borderRadius','padding','margin','backgroundColor','color','transition'].forEach(k=>{
          if (cs[k] && cs[k] !== 'auto') btn.style[k] = cs[k];
        });
        // Keep inline minimal, rely on classes for hover/focus; adjust spacing
        if (!btn.style.marginLeft || btn.style.marginLeft === '0px') btn.style.marginLeft = '8px';
      }
    }

    return true;
  }

  // Robust attach + retries
  if (!window.__SUBS_STABLE_BTN_OBS2__) {
    window.__SUBS_STABLE_BTN_OBS2__ = new MutationObserver(()=>{ try{ injectButtonIntoPlayer(); }catch{} });
    window.__SUBS_STABLE_BTN_OBS2__.observe(document.documentElement, { childList:true, subtree:true });
    document.addEventListener('DOMContentLoaded', ()=>{ try{ injectButtonIntoPlayer(); }catch{} }, { once:true });
    [200,800,2000,4000].forEach(t=> setTimeout(()=>{ try{ injectButtonIntoPlayer(); }catch{} }, t));
  }

  // Expose for other code if needed
  window.subsStableAttachButton = injectButtonIntoPlayer;
})();
