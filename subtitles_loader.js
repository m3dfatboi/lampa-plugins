(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader',
        version: '1.2',
        description: 'Загружает субтитры из OpenSubtitles во время просмотра торрентов',
        params: {
            api_key: { type: 'string', name: 'OpenSubtitles API Key', default: '' },
            language: { type: 'string', name: 'Язык субтитров (например, rus)', default: 'rus' }
        },
        init: function () {
            // Слушатель на запуск видео, но только для добавления внешних субтитров
            Lampa.Player.listen('start', this.tryLoadExternalSubtitles.bind(this));
            // Добавляем настройки в правую шторку
            this.addToSettingsSidebar();
        },
        addToSettingsSidebar: function () {
            // Добавляем в шторку настроек через Settings
            var settings = Lampa.Settings.main();
            settings.add('subtitles_settings', {
                title: 'Настройки субтитров OpenSubtitles',
                icon: 'subtitles',
                onClick: function () {
                    Lampa.Params.open({
                        title: 'Настройки плагина',
                        params: plugin.params,
                        onChange: function (params) {
                            Lampa.Storage.set('subtitles_api_key', params.api_key);
                            Lampa.Storage.set('subtitles_language', params.language);
                            Lampa.Noty.show('Настройки сохранены! Попробуйте запустить видео.');
                        }
                    });
                }
            });
        },
        tryLoadExternalSubtitles: function (data) {
            // Проверяем, если это торрент и есть ключ — только тогда загружаем внешние
            var apiKey = Lampa.Storage.get('subtitles_api_key') || '';
            var lang = Lampa.Storage.get('subtitles_language') || 'rus';

            if (data.source !== 'torrent' || !apiKey) {
                // Не трогаем встроенные субтитры, если условий нет
                return;
            }

            var movieName = data.title || '';

            // Запрос на поиск
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/subtitles',
                method: 'GET',
                headers: { 'Api-Key': apiKey },
                params: { query: movieName, languages: lang },
                success: function (response) {
                    if (response.data && response.data.length > 0) {
                        var fileId = response.data[0].attributes.files[0].file_id;
                        plugin.downloadAndAddSubtitle(fileId, apiKey, lang);
                    } else {
                        Lampa.Noty.show('Внешние субтитры не найдены.');
                    }
                },
                error: function () {
                    Lampa.Noty.show('Ошибка поиска внешних субтитров.');
                }
            });
        },
        downloadAndAddSubtitle: function (fileId, apiKey, lang) {
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/download',
                method: 'POST',
                headers: { 'Api-Key': apiKey },
                data: { file_id: fileId },
                success: function (response) {
                    if (response.link) {
                        // Добавляем только внешние субтитры, не трогая встроенные
                        Lampa.Player.subtitle.add({ url: response.link, lang: lang, label: 'OpenSubtitles' });
                        Lampa.Noty.show('Внешние субтитры добавлены!');
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
