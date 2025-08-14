(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader (ORG)',
        version: '1.2',
        description: 'Автоматически загружает субтитры из OpenSubtitles.org для торрентов',
        init: function () {
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
        },
        loadSubtitles: function (data) {
            var username = 'm3dboi'; // Твой username от opensubtitles.org
            var password = 'N2P9XEYaisx#+ms'; // Твой password
            var lang = 'rus'; // Дефолтный язык (измени, если нужно)
            var useragent = 'OSTestUserAgent';

            if (data.source !== 'torrent') return;

            var movieName = data.title || '';

            var loginXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>LogIn</methodName><params><param><value><string>' + username + '</string></value></param><param><value><string>' + password + '</string></value></param><param><value><string>' + lang + '</string></value></param><param><value><string>' + useragent + '</string></value></param></params></methodCall>';

            Lampa.Network.request({
                url: 'https://api.opensubtitles.org/xml-rpc',
                method: 'POST',
                headers: { 'Content-Type': 'text/xml' },
                data: loginXml,
                success: function (loginResponse) {
                    var tokenMatch = loginResponse.match(/<name>token<\/name>\s*<value><string>([^<]+)<\/string><\/value>/);
                    var token = tokenMatch ? tokenMatch[1] : null;
                    if (!token) return;

                    var searchXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>SearchSubtitles</methodName><params><param><value><string>' + token + '</string></value></param><param><value><array><data><value><struct><member><name>query</name><value><string>' + movieName + '</string></value></member><member><name>sublanguageid</name><value><string>' + lang + '</string></value></member></struct></value></data></array></value></param></params></methodCall>';

                    Lampa.Network.request({
                        url: 'https://api.opensubtitles.org/xml-rpc',
                        method: 'POST',
                        headers: { 'Content-Type': 'text/xml' },
                        data: searchXml,
                        success: function (searchResponse) {
                            var idMatch = searchResponse.match(/<name>IDSubtitleFile<\/name>\s*<value><string>([^<]+)<\/string><\/value>/);
                            var subtitleId = idMatch ? idMatch[1] : null;
                            if (!subtitleId) return;

                            var downloadXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>DownloadSubtitles</methodName><params><param><value><string>' + token + '</string></value></param><param><value><array><data><value><string>' + subtitleId + '</string></value></data></array></value></param></params></methodCall>';

                            Lampa.Network.request({
                                url: 'https://api.opensubtitles.org/xml-rpc',
                                method: 'POST',
                                headers: { 'Content-Type': 'text/xml' },
                                data: downloadXml,
                                success: function (downloadResponse) {
                                    var base64Match = downloadResponse.match(/<name>data<\/name>\s*<value><string>([^<]+)<\/string><\/value>/);
                                    var base64Data = base64Match ? base64Match[1] : null;
                                    if (!base64Data) return;

                                    var srtContent = atob(base64Data);
                                    var blob = new Blob([srtContent], { type: 'text/plain' });
                                    var subUrl = URL.createObjectURL(blob);

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
