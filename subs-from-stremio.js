(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader (ORG)',
        version: '1.4',
        description: 'Автоматически загружает субтитры из OpenSubtitles.org для торрентов',
        init: function () {
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
        },
        loadSubtitles: function (data) {
            var username = 'm3dboi';
            var password = 'N2P9XEYaisx#+ms';
            var lang = 'rus';
            var useragent = 'OSTestUserAgent';

            if (data.source !== 'torrent') return;

            var movieName = data.title || '';

            var loginXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>LogIn</methodName><params><param><value><string>' + username + '</string></value></param><param><value><string>' + password + '</string></value></param><param><value><string>' + lang + '</string></value></param><param><value><string>' + useragent + '</string></value></param></params></methodCall>';

            Lampa.Network.request({
                url: 'https://api.opensubtitles.org/xml-rpc',
                method: 'POST',
                headers: { 'Content-Type': 'text/xml' },
                data: loginXml,
                success: function (loginRes) {
                    var tokenStart = loginRes.indexOf('<string>') + 8;
                    var tokenEnd = loginRes.indexOf('</string>', tokenStart);
                    var token = loginRes.substring(tokenStart, tokenEnd).trim();
                    if (!token) return;

                    var searchXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>SearchSubtitles</methodName><params><param><value><string>' + token + '</string></value></param><param><value><array><data><value><struct><member><name>query</name><value><string>' + movieName + '</string></value></member><member><name>sublanguageid</name><value><string>' + lang + '</string></value></member></struct></value></data></array></value></param></params></methodCall>';

                    Lampa.Network.request({
                        url: 'https://api.opensubtitles.org/xml-rpc',
                        method: 'POST',
                        headers: { 'Content-Type': 'text/xml' },
                        data: searchXml,
                        success: function (searchRes) {
                            var idStart = searchRes.indexOf('<string>', searchRes.indexOf('IDSubtitleFile')) + 8;
                            var idEnd = searchRes.indexOf('</string>', idStart);
                            var subtitleId = searchRes.substring(idStart, idEnd).trim();
                            if (!subtitleId) return;

                            var downloadXml = '<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>DownloadSubtitles</methodName><params><param><value><string>' + token + '</string></value></param><param><value><array><data><value><string>' + subtitleId + '</string></value></data></array></value></param></params></methodCall>';

                            Lampa.Network.request({
                                url: 'https://api.opensubtitles.org/xml-rpc',
                                method: 'POST',
                                headers: { 'Content-Type': 'text/xml' },
                                data: downloadXml,
                                success: function (downloadRes) {
                                    var dataStart = downloadRes.indexOf('<string>', downloadRes.indexOf('data')) + 8;
                                    var dataEnd = downloadRes.indexOf('</string>', dataStart);
                                    var base64Data = downloadRes.substring(dataStart, dataEnd).trim();
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
