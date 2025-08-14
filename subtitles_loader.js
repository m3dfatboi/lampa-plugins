(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader',
        version: '1.5',
        description: 'Загружает субтитры из OpenSubtitles во время просмотра торрентов',
        params: {
            api_key: { type: 'string', name: 'OpenSubtitles API Key', default: '' },
            language: { type: 'string', name: 'Язык субтитров (например, rus)', default: 'rus' }
        },
        init: function () {
            // Слушатель на запуск видео
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
            // Добавляем пункт в шторку настроек
            this.addSettingsToSidebar();
        },
        addSettingsToSidebar: function () {
            // Простая интеграция в шторку через Settings.addComponent (из примеров 2025)
            Lampa.Settings.addComponent({
                id: 'opensubtitles_settings',
                title: 'Настройки субтитров OpenSubtitles',
                icon: 'subtitles',
                onOpen: function () {
                    Lampa.Params.open({
                        title: 'Настройки',
                        params: plugin.params,
                        onChange: function (params) {
                            Lampa.Storage.set('subtitles_api_key', params.api_key);
                            Lampa.Storage.set('subtitles_language', params.language);
                            Lampa.Noty.show('Настройки сохранены!');
                        }
                    });
                }
            });
        },
        loadSubtitles: function (data) {
            var apiKey = Lampa.Storage.get('subtitles_api_key') || '';
            var lang = Lampa.Storage.get('subtitles_language') || 'rus';

            if (!apiKey || data.source !== 'torrent') return; // Пропускаем, не ломая встроенные

            var movieName = data.title || '';

            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/subtitles',
                method: 'GET',
                headers: { 'Api-Key': apiKey },
                params: { query: movieName, languages: lang },
                success: function (response) {
                    if (response.data && response.data.length > 0) {
                        var fileId = response.data[0].attributes.files[0].file_id;
                        plugin.downloadSubtitle(fileId, apiKey);
                    } else {
                        Lampa.Noty.show('Субтитры не найдены.');
                    }
                },
                error: function () {
                    Lampa.Noty.show('Ошибка поиска.');
                }
            });
        },
        downloadSubtitle: function (fileId, apiKey) {
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/download',
                method: 'POST',
                headers: { 'Api-Key': apiKey },
                data: { file_id: fileId },
                success: function (response) {
                    if (response.link) {
                        Lampa.Player.subtitle.add({ url: response.link, lang: 'rus', label: 'OpenSubtitles' });
                        Lampa.Noty.show('Субтитры загружены!');
                    }
                },
                error: function () {
                    Lampa.Noty.show('Ошибка скачивания.');
                }
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
