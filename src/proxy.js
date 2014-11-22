var parser = require('parse-rss'),
    mysql = require('mysql'),
    x = require('./xml.js');

module.exports = {
    createOrFetch: function(db, feed_url, client, callback) {
        var self = this;
        var feed;
        // We're going to exclude client access times within the last 10 minutes ...
        // Repeat accesses probably mean we should return the whole feed,
        // maybe something went screwy and someone's hitting refresh
        var padding = (new Date()).getTime();
        db.query('SELECT feeds.*,clients.last_access_timestamp FROM feeds LEFT JOIN clients on (feeds.id=clients.feed_id AND clients.name=? AND clients.last_access_timestamp < ?) WHERE feed_url=?', [client, (padding-360000), feed_url], function(err, rows) {
            if (err) {
                callback(err);
                return;
            }
            if (rows.length == 0) {
                console.log('Have not seen this feed before, fetching+creating anew');
                // Not found, so create and fetch it
                self.fetch(db, feed_url, function(error) {
                    if (error) {
                        callback(error);
                        return;
                    }

                    // Try once more
                    db.query('SELECT * FROM feeds WHERE feed_url=?', [feed_url], function(err, rows) {
                        if (err) {
                            callback(err);
                            return;
                        }
                        feed = rows[0];
                        self.updateClientAccessTime(db, feed, client);
                        callback(null, feed);
                    });
                });
            } else {
                console.log('Familiar with this feed');
                // Has it been a while? If so, fetch again
                feed = rows[0];
                if (feed.last_fetched_timestamp < ((new Date()).getTime() - 21600000)) {
                    console.log('Have not fetched in a while, refreshing ...');
                    self.fetch(db, feed_url, function(error, feed) {
                        if (error) {
                            return callback(error);
                        }
                        self.updateClientAccessTime(db, feed, client);
                        callback(null, feed);
                    });
                } else {
                    console.log('Has not been long enough. Using cached version');
                    self.updateClientAccessTime(db, feed, client);
                    callback(null, rows[0]);
                }
            }
        });
    },
    fetch: function(db, feed_url, callback) {
        parser(feed_url, function(err, rss) {
            if (err) {
                callback(err);
                return;
            }
            if (rss.length == 0) {
                callback('Feed has no items (' + feed_url + ')');
                return;
            }
            var data = {
                feed_url: feed_url,
                title: rss[0].meta.title,
                website: rss[0].meta.link,
                description: rss[0].meta.description,
                feed_image_url: rss[0].meta.image.url,
                last_fetched_timestamp: (new Date()).getTime(),
                last_updated_timestamp: (new Date(rss[0].meta.date)).getTime()
            };

            var sequential = function(feed_id, rows, callback) {
                var work = function() {
                    var item,
                        data;
                    if (rows.length == 0) {
                        return callback(null);
                    }
                    item = rows.pop();
                    // No audio file, skip it
                    if (!item.enclosures || item.enclosures.length == 0) {
                        return work();
                    }
                    data = {
                        feed_id: feed_id,
                        guid: item.guid,
                        title: item.title,
                        description: item.description,
                        timestamp: (new Date(item.pubdate)).getTime(),
                        item_url: item.link,
                        audio_url: item.enclosures[0].url,
                        audio_mimetype: item.enclosures[0].type,
                        audio_length: item.enclosures[0]['length'] || 0
                    };
                    db.query('REPLACE INTO items SET ' + mysql.escape(data), function(error, result) {
                        if (error) {
                            return callback(error);
                        }
                        work();
                    });
                };
                work();
            };

            db.query('REPLACE INTO feeds SET ' + mysql.escape(data), function(error, result) {
                if (error) {
                    return callback(error);
                }
                data.id = result.insertId;

                // Insert the items
                sequential(data.id, rss, function(error) {
                    if (error) {
                        return callback(error);
                    }
                    callback(null, data);
                });
            });
        });
    },

    feedXML: function(db, feed, since, callback) {
        db.query('SELECT * FROM items WHERE feed_id=? AND `timestamp`>? ORDER BY `timestamp` DESC', [feed.id, since], function(err, rows) {
            if (err) {
                callback(err);
                return;
            }
            var channel = x('channel',
                x('title').cdata(feed.title),
                x('link', feed.feed_url),
                x('image',
                    x('url', feed.feed_image_url)
                ),
                x('itunes:image').attribute('href', feed.feed_image_url)
            );
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var date = new Date(row.timestamp);
                channel.child(
                    x('item',
                        x('guid', row.guid),
                        x('pubDate', date.toUTCString()),
                        x('title').cdata(row.title),
                        x('description').cdata(row.description),
                        x('link', row.website),
                        x('enclosure').attributes({url: row.audio_url, length: ''+row.audio_length, type: row.audio_mimetype})
                    )
                );
            }
            callback(false, channel.toString('rss'));
        });
    },

    updateClientAccessTime: function(db, feed, client) {
        // Update access time
        var data = {
            name: client,
            feed_id: feed.id,
            last_access_timestamp: (new Date()).getTime()
        };
        db.query('REPLACE INTO clients SET ' + mysql.escape(data));
    }

};

