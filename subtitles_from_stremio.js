(function () {
    'use strict';

    Lampa.Plugin.add({
        plugin_name: 'auto_subtitles',
        name: 'Auto Subtitles',
        description: 'Автоматические субтитры для торрентов',
        version: '1.0.0',
        init: function () {
            this.addSubtitles();
        },
        addSubtitles: function () {
            Lampa.Listener.follow('full', function (e) {
                if (e.method === 'torrent') {
                    setTimeout(function() {
                        var title = e.object.movie.title || e.object.movie.name;
                        var year = e.object.movie.release_date ? e.object.movie.release_date.split('-')[0] : '';
                        
                        if (title) {
                            // Используем бесплатный API от OpenSubtitles
                            var searchQuery = encodeURIComponent(title + (year ? ' ' + year : ''));
                            var subtitleUrl = 'https://rest.opensubtitles.org/search/query-' + searchQuery + '/sublanguageid-rus';
                            
                            Lampa.Utils.get(subtitleUrl, function(data) {
                                if (data && data.length > 0) {
                                    var sub = data[0];
                                    if (sub.SubDownloadLink) {
                                        Lampa.Player.subtitle({
                                            url: sub.SubDownloadLink,
                                            label: 'Русские (авто)'
                                        });
                                    }
                                }
                            });
                        }
                    }, 3000);
                }
            });
        }
    });

})();
