var request = require('request'),
    FeedParser = require('feedparser'),
    mysql = require('mysql'),
    x = require('./xml.js'),
    debug = require('./debug.js')('proxy.js'),
    crypto = require('crypto');

module.exports = function(db, client, user_agent) {
    var request_timestamp = Date.now();

    // Get id for a feed by url, or create an id if we've never seen this feed url before
    var getFeedIdForUrl = function(feed_url, callback) {
        db.query('SELECT id from feed_ids where url=?', [feed_url], function(err, rows) {
            if (err) {
                debug.error(feed_url + err);
                callback(err);
                return;
            }
            if (rows.length > 0) {
                callback(null, rows[0]['id']);
            } else {
                var row = {
                    id: Date.now(), // use milliseconds timestamp as our ID
                    url: feed_url
                };
                db.query('INSERT INTO feed_ids SET ?', row, function(err, result) {
                    if (err) {
                        callback(err);
                        return;
                    }
                    callback(null, row.id);
                });
            }
        });
    };

    var createOrFetch = function(feed_id, feed_url, callback) {
        db.query('SELECT feeds.*,clients.last_access_timestamp FROM feeds LEFT JOIN clients on (feeds.id=clients.feed_id AND clients.name=?) WHERE feeds.id=?', [client, feed_id], function(err, rows) {
            var feed = null,
                fetch = false;
            if (err) {
                callback(err);
                return;
            }
            if (rows.length > 0) {
                feed = rows[0];
                feed_url = feed.feed_url;
                if (!feed.last_access_timestamp) {
                    feed.last_access_timestamp = 0;
                }

                debug.log(feed_url + " is familiar. Last access: " + feed.last_access_timestamp);
                if (feed.status == 0) {
                    // Feed is disabled
                    debug.log(feed_url + " has been disabled. No items will be returned");
                // Has it been 6 hours since we last fetched the feed?
                } else if (feed.last_fetched_timestamp < (request_timestamp - 21600000)) {
                    debug.log(feed_url + " needs a refresh. Returning newest since " + feed.last_access_timestamp);
                    fetch = true;
                    /*
                    Scenarios to watch out for:
                        One
                            - ClientA causes FeedA to be fetched
                            - ClientA requests FeedA an hour later, too soon for us to re-fetch the feed
                            - Feed gets new item: Item50
                            - ClientA requests feed after Item50 added, but too soon for us to re-fetch the feed
                            - ClientA requests feed, late enough that we re-fetch the feed
                            - We give ClientA everything that arrived since the last time we fetched, which includes Item50

                        Two
                            - ClientA causes FeedB to be fetched
                            - ClientB requests FeedB, late enough that we re-fetch. We give ClientB all items
                            - ClientA requests FeedB, we return all items since ClientA's last request
                    */

                    // To account for multiple clients fetching the same feed:
                    // Give them the items since we last fetched the feed, or when the client last requested,
                    // whichever is earlier.
                    feed.last_access_timestamp = Math.min(feed.last_access_timestamp, feed.last_fetched_timestamp);

                // If client requested the feed less than 60 seconds ago, give it all items. This is a failsafe, in case
                // something messes up with the proxy or your podcast client. It's also a workaround for AntennaPod's behavior
                // of refetching when you subscribe to a feed
                } else if (feed.last_access_timestamp > (request_timestamp - 60000)) {
                    debug.log(feed_url + " Client seen recently, returning all items");
                    feed.last_access_timestamp = 0;
                } else {
                    debug.log(feed_url + " Returning newest items since " + feed.last_access_timestamp);
                }
            } else {
                debug.log(feed_url + " is new to me");
                fetch = true;
                feed = {
                    last_access_timestamp: 0
                };
            }

            if (fetch) {
                fetchAndSave(feed_id, feed_url, function(error, feed2) {
                    if (error) {
                        callback(error);
                        return;
                    }
                    callback(null, feed2, feed.last_access_timestamp);
                });
            } else {
                callback(null, feed, feed.last_access_timestamp);
            }
        });
    };
    var fetchAndSave = function(feed_id, feed_url, callback) {
        var req = request(feed_url, {timeout: 10000, pool: false});

        //req.setMaxListeners(50);
        // Some feeds do not respond without user-agent and accept headers.
        req.setHeader('user-agent', user_agent);
        req.setHeader('accept', 'text/html,application/xhtml+xml');

        req.on('response', function(res) {
            var feedparser,
                bytes = 0,
                items = [];
            if (res.statusCode != 200) {
                debug.error(feed_url + " errored while fetching: " + res.statusCode);
                callback('Failed to fetch feed. Status code: ' + res.statusCode);
                return;
            }

            // If we encountered redirects during fetching, update our feeds row with the new URL
            if (res.request._redirect.redirects.length > 0) {
                var hops = res.request._redirect.redirects,
                    last_hop;
                // Add all hops to our feed_ids table, all pointing to the same feed_id
                for (var i = 0; i < hops.length; i++) {
                    last_hop = hops[i];
                    db.query('INSERT INTO feed_ids SET ?', {url:last_hop.redirectUri, id:feed_id});
                }
                debug.log(feed_url + " redirected to " + last_hop.redirectUri);
                feed_url = last_hop.redirectUri;
            }

            res.on('data', function(data) {
                bytes += data.length;
            });
            res.on('end', function() {
                // Suppose we could get content the length from res.headers, but what if it's wrong?
                debug.log(feed_url + " size in bytes: " + bytes);
            });

            feedparser = new FeedParser({addmeta:false});
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
                        feed_image_url: (this.meta.image ? this.meta.image.url : ''),
                        last_fetched_timestamp: request_timestamp
                    };

                debug.log(feed_url + " has " + items.length + ' items');
                if (items.length == 0) {
                    // Nothing to insert
                    return callback(null, []);
                }
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

            res.pipe(feedparser);
        });

        // This helps us sequentially insert feed items into the database
        var sequential = function(rows, callback) {
            var work = function() {
                var items = [],
                    item,
                    sql,
                    data = [],
                    timestamp;
                if (rows.length == 0) {
                    return callback(null);
                }
                
                // Insert 5 at a time
                items = rows.splice(0, 50);
                sql = 'REPLACE INTO items (feed_id,id,guid,title,description,timestamp,item_url,audio_url,audio_mimetype,audio_length) VALUES ?';
                for (var i = 0; i < items.length; i++) {
                    item = items[i];

                    // No audio file, skip it
                    if (!item.enclosures || item.enclosures.length == 0) {
                        continue;
                    }
                    // No guid (maybe feed has moved over the years?)
                    if (!item.guid && !item.link) {
                        debug.error('Skipping ' + item.title);
                        continue;
                    }
                    timestamp = item.pubdate.valueOf();
                    data.push([
                        feed_id, // feed_id
                        timestamp, // use timestamp for the id
                        item.guid || item.link, // guid
                        item.title,
                        item.description, // description
                        // what if date parsing fails?
                        timestamp, // timestamp
                        item.link, // item_url
                        item.enclosures[0].url, // audio_url
                        item.enclosures[0].type, // audio_mimetype
                        item.enclosures[0]['length'] || 0 // audio_length
                    ]);
                }
                if (data.length == 0) {
                    return work();
                }
                db.query(sql, [data], function(error, result) {
                    if (error) {
                        return callback(error);
                    }
                    work();
                });
            };
            work();
        };
    };

    var feedXML = function(feed, since, callback) {
        db.query('SELECT * FROM items WHERE feed_id=? AND `timestamp`>? ORDER BY `timestamp` DESC', [feed.id, since], function(err, rows) {
            if (err) {
                callback(err);
                return;
            }
            // TODO: make sure we don't assign null when building up XML. fallback to empty string or entity conversion will bomb
            var channel = x('channel',
                x('title').cdata(feed.title),
                x('link', feed.feed_url),
                x('image',
                    x('url', feed.feed_image_url)
                ),
                x('itunes:image').attribute('href', feed.feed_image_url || ''),
                x('description').cdata(feed.description)
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
        // Set Client access time to the start of it's latest request
        var data = {
            name: client,
            feed_id: feed.id,
            last_access_timestamp: request_timestamp // from above, the top of module.exports
        };
        debug.log(feed.feed_url + " Updating client access to " + data.last_access_timestamp);
        db.query('REPLACE INTO clients SET ' + mysql.escape(data));
    };

    return {
        fetch: function(feed_url, callback) {
            getFeedIdForUrl(feed_url, function(error, feed_id) {
                if (error) {
                    callback(error);
                    return;
                }
                createOrFetch(feed_id, feed_url, function(error, feed, last_access_timestamp) {
                    if (error) {
                        callback(error);
                        return;
                    }
                    feedXML(feed, last_access_timestamp, function(error, xml) {
                        if (error) {
                            callback(error);
                            return;
                        }
                        updateClientAccessTime(feed);
                        debug.log(feed.feed_url + " Output XML size: " + xml.length);
                        callback(null, xml);
                    });
                });
            });
        }
    };

};

