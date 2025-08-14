(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader',
        version: '1.4',
        description: 'Загружает субтитры из OpenSubtitles во время просмотра торрентов',
        params: {
            api_key: { type: 'string', name: 'OpenSubtitles API Key', default: '' },
            language: { type: 'string', name: 'Язык субтитров (например, rus)', default: 'rus' }
        },
        init: function () {
            // Условный слушатель для плеера
            Lampa.Player.listen('start', this.tryLoadExternalSubtitles.bind(this));
            // Добавление в шторку настроек
            this.addToSettingsSidebar();
        },
        addToSettingsSidebar: function () {
            // Проверяем наличие Settings.component (для совместимости с версиями 2025)
            if (Lampa.Settings && Lampa.Settings.component) {
                Lampa.Settings.component.add('opensubtitles', {
                    title: 'OpenSubtitles',
                    subtitle: 'Настройки внешних субтитров',
                    icon: 'subtitles',
                    onClick: function () {
                        Lampa.Params.open({
                            title: 'Настройки плагина',
                            params: plugin.params,
                            onChange: function (params) {
                                Lampa.Storage.set('subtitles_api_key', params.api_key);
                                Lampa.Storage.set('subtitles_language', params.language);
                                Lampa.Noty.show('Настройки сохранены! Перезапустите видео.');
                            }
                        });
                    }
                });
            } else {
                Lampa.Noty.show('Версия Lampa не поддерживает эту интеграцию. Обновите приложение.');
            }
        },
        tryLoadExternalSubtitles: function (data) {
            var apiKey = Lampa.Storage.get('subtitles_api_key') || '';
            var lang = Lampa.Storage.get('subtitles_language') || 'rus';

            // Пропускаем, если нет ключа или не торрент — не трогаем встроенные субтитры
            if (!apiKey || data.source !== 'torrent') return;

            var movieName = data.title || data.movie.title || '';

            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/subtitles',
                method: 'GET',
                headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
                params: { query: movieName, languages: lang },
                success: function (response) {
                    if (response.data && response.data.length > 0) {
                        var fileId = response.data[0].attributes.files[0].file_id;
                        plugin.downloadAndAddSubtitle(fileId, apiKey, lang);
                    } else {
                        Lampa.Noty.show('Субтитры не найдены.');
                    }
                },
                error: function (err) {
                    Lampa.Noty.show('Ошибка поиска: ' + (err.message || 'Проверьте ключ.'));
                }
            });
        },
        downloadAndAddSubtitle: function (fileId, apiKey, lang) {
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/download',
                method: 'POST',
                headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
                data: { file_id: fileId },
                success: function (response) {
                    if (response.link) {
                        Lampa.Player.subtitle.add({ url: response.link, lang: lang, label: 'OpenSubtitles' });
                        Lampa.Noty.show('Субтитры добавлены!');
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
