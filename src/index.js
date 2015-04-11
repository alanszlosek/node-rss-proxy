var http = require('http'),
    url = require('url'),
    config = require('../config.js'),
    Proxy = require('./proxy.js'),
    mysql = require('mysql'),
    dbPool = mysql.createPool(config.db),
    debug = require('./debug.js')('index.js'),
    StatsdClient = require('node-statsd-client').Client;

var server = http.createServer(function (req, res) {
    var statsd = new StatsdClient('127.0.0.1', 8125);
    var prefix = '/' + config.secret + '-';
    var start_milliseconds = Date.now();
    var milliseconds;

    statsd.count('node-rss-proxy.requests.any', 1);
    if (req.url.substr(0, prefix.length) != prefix) {
        debug.error('Bad request: ' + req.url);
        res.writeHead(404, { 'Content-Type': 'text/html' })
        res.end('404 Not found');

        statsd.count('node-rss-proxy.requests.404', 1);
        milliseconds = (Date.now() - start_milliseconds);
        statsd.timing('node-rss-proxy.requests.any', milliseconds);
        statsd.timing('node-rss-proxy.requests.404', milliseconds);
        return;
    }
    var i = req.url.indexOf('/', prefix.length);
    var client = req.url.substring(prefix.length, i);
    var feed_url = req.url.substr(i+1);
    debug.log('Client and feed: ' + client + ' ' + feed_url);
    debug.log('Request from: ' + req.headers['user-agent']);

    dbPool.getConnection(function(error, db) {
        if (error) {
            debug.error('Error getting connection from pool: ' + error);
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end('500 DB error');

            statsd.count('node-rss-proxy.requests.500', 1);
            milliseconds = (Date.now() - start_milliseconds);
            statsd.timing('node-rss-proxy.requests.any', milliseconds);
            statsd.timing('node-rss-proxy.requests.500', milliseconds);
            return;
        }
        // We relay the user agent when fetching the feed from the proxy
        var proxy = new Proxy(db, client, req.headers['user-agent']);
        proxy.fetch(feed_url, function(error, xml) {
            try {
                db.release();
            } catch (e) {
                debug.error('Exeption while trying to release DB connection: ' + e);
            }
            if (error) {
                statsd.count('node-rss-proxy.requests.404', 1);
                debug.error(error);
                res.writeHead(404, { 'Content-Type': 'text/html' })
                res.end('404 Not found');

                milliseconds = (Date.now() - start_milliseconds);
                statsd.timing('node-rss-proxy.requests.any', milliseconds);
                statsd.timing('node-rss-proxy.requests.404', milliseconds);
                return;
            }
            //console.log('Last access: ' + feed.last_access_timestamp);
            res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
            res.end(xml);

            statsd.count('node-rss-proxy.requests.200', 1);
            milliseconds = (Date.now() - start_milliseconds);
            statsd.timing('node-rss-proxy.requests.any', milliseconds);
            statsd.timing('node-rss-proxy.requests.200', milliseconds);
        });
    });
});

server.listen(Number(process.argv[2]));

