// ==UserScript==
// @name        Subtitle Translator for Lampa
// @namespace   lampa_plugin_subtitle_translate
// @version     1.0
// @description Plugin to auto-translate embedded subtitles using online API
// @match       *://*.lampa.*/*
// ==/UserScript==

(function(){
    // Язык перевода (ru -> en, en -> ru и т.д.)
    const TARGET_LANG = 'ru';

    // LibreTranslate endpoint
    const TRANSLATE_API = 'https://libretranslate.com/translate';

    // Получение текста субтитров из файла (srt, ass, vtt)
    function extractSubtitleText(subtitles){
        // subtitles — строка с содержимым файла
        // Простой парс для .srt: вытянуть только реплики
        return subtitles.replace(/\d+\s*\n/g, '')
            .replace(/(\d{2}:\d{2}:\d{2},\d{3} --> .*)\n/g, '')
            .replace(/\n{2,}/g, '\n')
            .trim()
            .split('\n');
    }

    // Отправка одной реплики на перевод
    async function translateLine(line){
        const response = await fetch(TRANSLATE_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: line,
                source: 'en',
                target: TARGET_LANG,
                format: 'text'
            })
        });
        const data = await response.json();
        return data.translatedText || line;
    }

    // Перевод всех реплик (можно дополнительно разбивать пачками)
    async function translateSubtitles(subtitleContent){
        const lines = extractSubtitleText(subtitleContent);
        const translatedLines = [];
        for(let line of lines){
            translatedLines.push(await translateLine(line));
        }
        return translatedLines;
    }

    // Встраивание перевода обратно в файл (srt, простая замена реплик)
    function applyTranslation(originalSubtitle, translatedLines){
        let i = 0;
        return originalSubtitle.replace(/(\d+\n\d{2}:\d{2}:\d{2},\d{3} --> .*\n)([^\n]+)\n/g, function(match, header, text){
            return header + (translatedLines[i++] || text) + '\n';
        });
    }

    // Основная логика интеграции с Lampa
    window.lampa_subtitle_translate = async function(subtitleFileContent){
        let translated = await translateSubtitles(subtitleFileContent);
        let finalSubtitle = applyTranslation(subtitleFileContent, translated);
        // Здесь подключаем к плееру Lampa, например:
        // window.Lampa.Player.addExternalSubtitle(finalSubtitle, {lang: TARGET_LANG, name: 'Перевод'});
        alert('Субтитры переведены, подключение...'); // debug
        // Для подключения используйте соответствующий API Lampa
        return finalSubtitle;
    };

    // Кнопка для вызова перевода
    function addTranslateButton(){
        let btn = document.createElement('button');
        btn.innerText = 'Перевести субтитры';
        btn.onclick = async function(){
            // Получение файла субтитров (файл или из Lampa-плеера)
            let subtitleContent = ""; // TODO: Получить текущие субтитры (типа window.Lampa.Player.getCurrentSubtitle())
            let result = await window.lampa_subtitle_translate(subtitleContent);
            // Дальнейшее подключение — передать в плеер
        };
        document.body.appendChild(btn);
    }

    addTranslateButton(); // запускаем
})();
