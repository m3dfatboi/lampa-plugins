(function () {
const FLAG = 'SUBS_RU_OPEN_SUBS_SINGLE';
if (window[FLAG]) return; window[FLAG] = true;

const LANG = 'ru';
const LABEL = 'Субтитры (RU)';

const safe = v => (v == null ? '' : String(v));
const delay = ms => new Promise(r => setTimeout(r, ms));

function srtToVtt(srt) {
const t = safe(srt).replace(/\r+/g,'').trim();
return 'WEBVTT\n\n' + t
.replace(/^\d+\n/gm,'')
.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
.replace(/\n{3,}/g,'\n\n');
}

async function http(url, timeout=15000) {
const ctrl = new AbortController();
const id = setTimeout(()=>ctrl.abort(), timeout);
try {
const r = await fetch(safe(url), { method:'GET', credentials:'omit', mode:'cors', signal: ctrl.signal, headers:{'Accept':'text/html,application/json,/'}});
return r;
} finally { clearTimeout(id); }
}

function parseList(html) {
const doc = document.implementation.createHTMLDocument('');
doc.documentElement.innerHTML = safe(html);
const out = [];
doc.querySelectorAll('a[href*="/subtitles/"]').forEach(a=>{
const href = a.getAttribute('href')||'';
if (!href.includes('/subtitles/')) return;
const ctx = safe((a.closest('article,li,div,section,tr,tbody')||a.parentElement)?.textContent).toLowerCase();
const isRu = ctx.includes('russian') || ctx.includes('рус') || /\bru\b/.test(ctx) || /\brus\b/.test(ctx);
if (!isRu) return;
out.push({
name: safe(a.textContent).trim() || 'Russian subtitles',
pageUrl: new URL(href, 'https://www.opensubtitles.org/').toString()
});
});
const seen = new Set();
return out.filter(x=> (seen.has(x.pageUrl)?false:(seen.add(x.pageUrl),true)));
}

async function resolveDownload(pageUrl) {
const r = await http(pageUrl);
if (!r.ok) throw new Error('page');
const html = await r.text();
const doc = document.implementation.createHTMLDocument('');
doc.documentElement.innerHTML = html;
let el = doc.querySelector('a[href*="/download/"],a[href$=".srt"],a[href$=".vtt"],a[href$=".ass"]');
if (!el) el = Array.from(doc.querySelectorAll('a,button')).find(x=>{
const h = safe(x.getAttribute('href')||x.getAttribute('data-url'));
return /download|.srt|.vtt|.ass|скачать/i.test(h);
});
if (!el) throw new Error('no link');
const raw = el.getAttribute('href')||el.getAttribute('data-url')||'';
return new URL(raw, pageUrl).toString();
}

async function fetchVtt(dl) {
const r = await http(dl);
if (!r.ok) throw new Error('download');
const type = safe(r.headers.get('content-type')).toLowerCase();
const buf = await r.arrayBuffer();
let text = '';
try { text = new TextDecoder('utf-8').decode(buf); }
catch { text = new TextDecoder('windows-1251').decode(new Uint8Array(buf)); }
const vtt = (type.includes('text/vtt') || text.trim().startsWith('WEBVTT') || /.vtt(?|$)/i.test(dl)) ? text : srtToVtt(text);
return URL.createObjectURL(new Blob([vtt], { type:'text/vtt' }));
}

function getMeta(ctx) {
const d = ctx||{};
const imdbRaw = safe(d.imdb_id||d.imdb);
const imdb = imdbRaw.startsWith('tt')?imdbRaw:(imdbRaw?('tt'+imdbRaw):'');
return {
title: safe(d.title||d.name),
year: d.year?+d.year:(d.release_year?+d.release_year:''),
season: Number.isFinite(+d.season)?+d.season:0,
episode: Number.isFinite(+d.episode)?+d.episode:0,
imdb_id: imdb
};
}

function buildQueries(m) {
const qs = [];
if (m.imdb_id) qs.push(https://www.opensubtitles.org/en/search2/imdbid-${encodeURIComponent(m.imdb_id)}/sublanguageid-rus);
if (m.title && m.season && m.episode) {
const q = encodeURIComponent(${m.title} S${String(m.season).padStart(2,'0')}E${String(m.episode).padStart(2,'0')});
qs.push(https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q});
}
if (m.title && m.year) {
const q = encodeURIComponent(${m.title} ${m.year});
qs.push(https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q});
}
if (m.title) {
const q = encodeURIComponent(m.title);
qs.push(https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q});
}
return qs;
}

async function searchOS(meta) {
const qs = buildQueries(meta);
const out = [];
for (const u of qs) {
try {
await delay(300);
const r = await http(u);
if (!r.ok) continue;
out.push(...parseList(await r.text()));
} catch {}
}
const seen = new Set();
return out.filter(x=> (seen.has(x.pageUrl)?false:(seen.add(x.pageUrl),true)));
}

function pickList(items, onPick) {
// Только безопасные кнопки. Никаких url/link/… в самом item.
const list = items.map(x=>({ title: ${safe(x.name)} · OpenSubtitles, subtitle: LANG, item:'button', callback:()=>onPick({pageUrl:x.pageUrl}) }));
Lampa.Select.show({ title: LABEL, items: list, onBack: function(){} });
}

async function openPicker(ctx) {
const meta = getMeta(ctx);
if (!meta.title && !meta.imdb_id) { Lampa?.Noty?.show && Lampa.Noty.show('Нет метаданных для поиска'); return; }
Lampa?.Noty?.show && Lampa.Noty.show('Поиск русских субтитров…');
const list = await searchOS(meta);
if (!list.length) { Lampa?.Noty?.show && Lampa.Noty.show('Субтитры не найдены'); return; }
pickList(list, async (picked)=>{
try {
const dl = await resolveDownload(picked.pageUrl);
const vtt = await fetchVtt(dl);
const player = Lampa.Player || Lampa.PlayerVideo || Lampa.PlayerLite || {};
if (player.subtitles?.add) {
player.subtitles.clear && player.subtitles.clear();
player.subtitles.add({label:'Русские', language:LANG, url:vtt});
player.subtitles.enable && player.subtitles.enable(LANG);
} else if (Lampa.Player?.listener?.send) {
Lampa.Player.listener.send('subtitle', { label:'Русские', language:LANG, url:vtt });
} else if (Lampa.Event?.emit) {
Lampa.Event.emit('player_subtitle', { url:vtt, label:'Русские', lang:LANG });
}
Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
} catch { Lampa?.Noty?.show && Lampa.Noty.show('Ошибка загрузки субтитров'); }
});
}

function initOnce() {
// Только кнопка в плеере. Без регистрации плагина/источников/слушателей карточек.
if (Lampa.Player?.addInteractive) {
// На всякий случай уберём возможную предыдущую кнопку с тем же id (если сборка поддерживает)
try { Lampa.Player.removeInteractive && Lampa.Player.removeInteractive('subs-ru'); } catch {}
Lampa.Player.addInteractive({
id: 'subs-ru',
title: LABEL,
subtitle: LANG,
icon: 'cc',
onClick: () => {
const ctx = (Lampa.Player?.video && Lampa.Player.video()) || (Lampa.Activity?.active && Lampa.Activity.active()) || {};
openPicker(ctx);
}
});
}
}

if (window.Lampa) initOnce();
else document.addEventListener('lampa-ready', initOnce, { once:true });
})();
