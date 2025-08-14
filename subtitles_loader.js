(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader (ORG)',
        version: '1.0',
        description: 'Автоматически загружает субтитры из OpenSubtitles.org для торрентов',
        init: function () {
            // Слушатель на запуск видео
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
        },
        loadSubtitles: function (data) {
            // Настройки прямо в коде
            var username = 'm3dboi'; // Твой username от opensubtitles.org
            var password = 'N2P9XEYaisx#+ms'; // Твой password от opensubtitles.org
            var lang = 'rus'; // Дефолтный язык (измени, если нужно, например 'eng')
            var useragent = 'OSTestUserAgent'; // Обязательный User-Agent для API

            // Только для торрентов
            if (data.source !== 'torrent') return;

            var movieName = data.title || ''; // Название для поиска

            // Шаг 1: LogIn для получения токена
            var loginXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>LogIn</methodName><params><param><value><string>' + username + '</string></value></param><param><value><string>' + password + '</string></value></param><param><value><string>' + lang + '</string></value></param><param><value><string>' + useragent + '</string></value></param></params></methodCall>';

            Lampa.Network.request({
                url: 'https://api.opensubtitles.org/xml-rpc',
                method: 'POST',
                headers: { 'Content-Type': 'text/xml' },
                data: loginXml,
                success: function (loginResponse) {
                    // Парсим токен из XML (используем простой парсинг, так как Lampa не имеет встроенного XML-парсера)
                    var tokenMatch = loginResponse.match(/<string>([^<]+)<\/string>/);
                    var token = tokenMatch ? tokenMatch[1] : null;
                    if (!token) return;

                    // Шаг 2: SearchSubtitles
                    var searchXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>SearchSubtitles</methodName><params><param><value><string>' + token + '</string></value></param><param><value><array><data><value><struct><member><name>query</name><value><string>' + movieName + '</string></value></member><member><name>sublanguageid</name><value><string>' + lang + '</string></value></member></struct></value></data></array></value></param></params></methodCall>';

                    Lampa.Network.request({
                        url: 'https://api.opensubtitles.org/xml-rpc',
                        method: 'POST',
                        headers: { 'Content-Type': 'text/xml' },
                        data: searchXml,
                        success: function (searchResponse) {
                            // Парсим ID субтитров из XML
                            var idMatch = searchResponse.match(/<member><name>IDSubtitleFile<\/name><value><string>([^<]+)<\/string><\/value><\/member>/);
                            var subtitleId = idMatch ? idMatch[1] : null;
                            if (!subtitleId) return;

                            // Шаг 3: DownloadSubtitles
                            var downloadXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>DownloadSubtitles</methodName><params><param><value><string>' + token + '</string></value></param><param><value><array><data><value><string>' + subtitleId + '</string></value></data></array></value></param></params></methodCall>';

                            Lampa.Network.request({
                                url: 'https://api.opensubtitles.org/xml-rpc',
                                method: 'POST',
                                headers: { 'Content-Type': 'text/xml' },
                                data: downloadXml,
                                success: function (downloadResponse) {
                                    // Парсим base64-данные субтитров из XML
                                    var base64Match = downloadResponse.match(/<member><name>data<\/name><value><string>([^<]+)<\/string><\/value><\/member>/);
                                    var base64Data = base64Match ? base64Match[1] : null;
                                    if (!base64Data) return;

                                    // Декодируем base64 в текст SRT
                                    var srtContent = atob(base64Data);

                                    // Создаём Blob URL для добавления в плеер
                                    var blob = new Blob([srtContent], { type: 'text/plain' });
                                    var subUrl = URL.createObjectURL(blob);

                                    // Добавляем в плеер
                                    Lampa.Player.subtitle.add({ url: subUrl, lang: lang, label: 'OpenSubtitles.org' });
                                }
                            });
                        }
                    });
                }
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
