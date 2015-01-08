var request = require('request'),
    FeedParser = require('feedparser'),
    mysql = require('mysql'),
    x = require('./xml.js'),
    debug = require('debug')('proxy.js'),
    crypto = require('crypto');

module.exports = function(db, client, user_agent) {
    var createOrFetch = function(feed_id, feed_url, callback) {
        // We're going to exclude client access times within the last 10 minutes ...
        // Repeat accesses probably mean we should return the whole feed,
        // maybe something went screwy and someone's hitting refresh
        db.query('SELECT feeds.*,clients.last_access_timestamp FROM feeds LEFT JOIN clients on (feeds.id=clients.feed_id AND clients.name=?) WHERE feeds.id=?', [client, feed_id], function(err, rows) {
            var feed = null,
                fetch = false,
                now = (new Date()).getTime();
            if (err) {
                callback(err);
                return;
            }
            if (rows.length > 0) {
                feed = rows[0];
                if (!feed.last_access_timestamp) {
                    feed.last_access_timestamp = 0;
                }

                debug(feed_url + "\r\n\tFamiliar with this feed\r\n\tLast access: " + feed.last_access_timestamp);
                // Has it been 6 hours since we last fetched the feed?
                if (feed.last_fetched_timestamp < (now - 21600000)) {
                    debug(feed_url + "\r\n\tRefreshing feed, returning newest since " + feed.last_access_timestamp);
                    fetch = true;
                    // Client might have requested feed a few minutes ago,
                    // but since the feed is being refreshed, give them everything
                    // since last refresh
                    feed.last_access_timestamp = feed.last_fetched_timestamp;
                // If our client requested the feed less than 60 seconds ago, give him all items
                } else if (feed.last_access_timestamp > (now - 60000)) {
                    debug(feed_url + "\r\n\tClient seen recently, returning all items");
                    feed.last_access_timestamp = 0;
                } else {
                    debug(feed_url + "\r\n\tReturning newest items since " + feed.last_access_timestamp);
                }
            } else {
                debug(feed_url + "\r\n\tHave not seen this feed before");
                fetch = true;
            }

            if (fetch) {
                fetchAndSave(feed_id, feed_url, function(error, feed) {
                    if (error) {
                        callback(error);
                        return;
                    }
                    callback(null, feed);
                });
            } else {
                callback(null, feed);
            }
        });
    };
    var fetchAndSave = function(feed_id, feed_url, callback) {
        var req = request(feed_url, {timeout: 10000, pool: false}),
            feedparser = new FeedParser({addmeta:false}),
            items = [];
        //req.setMaxListeners(50);
        // Some feeds do not respond without user-agent and accept headers.
        req.setHeader('user-agent', user_agent);
        req.setHeader('accept', 'text/html,application/xhtml+xml');

        req.on('response', function(res) {
            var bytes = 0;
            if (res.statusCode != 200) {
                return this.emit('error', new Error('Bad status code'));
            }
            res.on('data', function(data) {
                bytes += data.length;
            });
            res.on('end', function() {
                debug(feed_url + "\r\n\tFeed size in bytes: " + bytes);
            });
            res.pipe(feedparser);
            // Can we get content length from res?
        });

        // This helps us sequentially insert feed items into the database
        var sequential = function(rows, callback) {
            var work = function() {
                var items = [],
                    item,
                    sql,
                    data = [],
                    num_rows = 0,
                    started;
                if (rows.length == 0) {
                    return callback(null);
                }
                
                // Insert 5 at a time
                items = rows.splice(0, 5);
                sql = 'REPLACE INTO items (feed_id,guid,title,description,timestamp,item_url,audio_url,audio_mimetype,audio_length) VALUES (?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)';
                for (var i = 0; i < items.length; i++) {
                    item = items[i];

                    // No audio file, skip it
                    if (!item.enclosures || item.enclosures.length == 0) {
                        continue;
                    }
                    // No guid (maybe feed has moved over the years?)
                    if (!item.guid && !item.link) {
                        debug('Skipping ' + item.title);
                        continue;
                    }
                    data.splice(-1, 0, 
                        feed_id, // feed_id
                        item.guid || item.link, // guid
                        item.title,
                        item.description, // description
                        (new Date(item.pubdate)).getTime(), // timestamp
                        item.link, // item_url
                        item.enclosures[0].url, // audio_url
                        item.enclosures[0].type, // audio_mimetype
                        item.enclosures[0]['length'] || 0 // audio_length
                    );
                    num_rows++;
                }
                if (num_rows == 0) {
                    return work();
                } else if (num_rows < 5) {
                    // Remove excess placeholders ... 20 characters worth for each row
                    sql = sql.slice(0, (-20 * (5 - num_rows)));
                }
                db.query(sql, data, function(error, result) {
                    if (error) {
                        return callback(error);
                    }
                    work();
                });
            };
            work();
        };

        feedparser.on('error', callback);
        feedparser.on('readable', function() {
            var item;
            while (item = this.read()) {
                items.push(item);
            }
        });
        feedparser.on('end', function() {
            var data = {
                    id: feed_id,
                    feed_url: feed_url,
                    title: this.meta.title,
                    website: this.meta.link,
                    description: this.meta.description,
                    feed_image_url: this.meta.image.url,
                    last_fetched_timestamp: (new Date()).getTime(),
                    last_updated_timestamp: (new Date(this.meta.date)).getTime()
                };

            debug(feed_url + "\r\n\tFeed has " + items.length + ' items');
            db.query('REPLACE INTO feeds SET ' + mysql.escape(data), function(error, result) {
                if (error) {
                    return callback(error);
                }

                // Insert the items
                sequential(items, function(error) {
                    if (error) {
                        return callback(error);
                    }
                    callback(null, data);
                });
            });
        });
    };

    var feedXML = function(feed, callback) {
        db.query('SELECT * FROM items WHERE feed_id=? AND `timestamp`>? ORDER BY `timestamp` DESC', [feed.id, feed.last_access_timestamp], function(err, rows) {
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
            var xml;
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
            xml = channel.toString('rss');
            callback(false, xml);
        });
    };

    var updateClientAccessTime = function(feed) {
        // Update access time
        var data = {
            name: client,
            feed_id: feed.id,
            last_access_timestamp: (new Date()).getTime()
        };
        debug(feed.feed_url + "\r\n\tUpdating client access to " + data.last_access_timestamp);
        db.query('REPLACE INTO clients SET ' + mysql.escape(data));
    };

    return {
        fetch: function(feed_url, callback) {
            var md5 = crypto.createHash('md5');
            // Calculate id for the feed, md5 of the url
            md5.update(feed_url.toLowerCase());
            createOrFetch(md5.digest('hex'), feed_url, function(error, feed) {
                if (error) {
                    callback(error);
                    return;
                }
                feedXML(feed, function(error, xml) {
                    if (error) {
                        callback(error);
                        return;
                    }
                    updateClientAccessTime(feed);
                    debug(feed_url + "\r\n\tOutput XML size: " + xml.length);
                    callback(null, xml);
                });
            });
        }
    };

};

