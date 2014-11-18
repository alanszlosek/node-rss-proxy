var http = require('http'),
    url = require('url'),
    mysql = require('mysql'),
    parser = require('parse-rss'),
    config = require('../config.js'),
    proxy = require('./proxy.js'),
    db = mysql.createConnection(config.db);
db.connect();

var server = http.createServer(function (req, res) {
    var prefix = '/' + config.secret + '-';
    if (req.url.substr(0, prefix.length) != prefix) {
        console.log('Bad request: ' + req.url);
        res.writeHead(404, { 'Content-Type': 'text/html' })
        res.end('404 Not found');
        return;
    }
    var i = req.url.indexOf('/', prefix.length);
    var client = req.url.substring(prefix.length, i);
    var feed_url = req.url.substr(i+1);
    console.log('Client and feed: ' + client + ' ' + feed_url);

    proxy.createOrFetch(feed_url, client, function(error, feed) {
        if (error) {
            console.log(error);
            res.writeHead(404, { 'Content-Type': 'text/html' })
            res.end('404 Not found');
            return;
        }
        if (!feed.last_access_timestamp) {
            feed.last_access_timestamp = 0;
        }
        // Update access time
        var date = new Date();
        var data = {
            name: client,
            feed_id: feed.id,
            last_access_timestamp: date.getTime()
        };
        db.query('REPLACE INTO clients SET ' + mysql.escape(data));

        proxy.feedXML(feed, feed.last_access_timestamp, function(error, xml) {
            if (error) {
                console.log(error);
                res.writeHead(404, { 'Content-Type': 'text/html' })
                res.end('404 Not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
            res.end(xml);
        });
    });
});

server.listen(Number(process.argv[2]));

