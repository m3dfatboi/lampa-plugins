(function () {
    'use strict';

    var plugin = {
        name: 'Test Plugin',
        version: '1.0',
        description: 'Простой тест для установки',
        init: function () {
            // Ничего не делаем, просто проверяем установку
        }
    };

    Lampa.Plugin.add(plugin);
})();
