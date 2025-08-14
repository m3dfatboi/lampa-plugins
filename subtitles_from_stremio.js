(function () {
    'use strict';

    Lampa.Plugin.add({
        plugin_name: 'test_subtitles',
        name: 'Test Subtitles Plugin',
        description: 'Простой тест плагина для субтитров',
        version: '1.0.0',
        init: function () {
            Lampa.Noty.show('Тестовый плагин загружен успешно!');
        }
    });

})();
