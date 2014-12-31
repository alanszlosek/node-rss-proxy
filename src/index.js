var http = require('http'),
    url = require('url'),
    config = require('../config.js'),
    Proxy = require('./proxy.js'),
    mysql = require('mysql'),
    dbPool = mysql.createPool(config.db);

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
    var user_agent = req.headers['user-agent'];
    var feed_url = req.url.substr(i+1);
    console.log('Client and feed: ' + client + ' ' + feed_url);
    console.log('Request from: ' + req.headers['user-agent']);

    dbPool.getConnection(function(error, db) {
        if (error) {
            console.log('Error getting connection from pool: ' + error);
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end('500 DB error');
            return;
        }
        var proxy = new Proxy(db, client, user_agent);
        proxy.fetch(feed_url, function(error, xml) {
            db.release();
            if (error) {
                console.log(error);
                res.writeHead(404, { 'Content-Type': 'text/html' })
                res.end('404 Not found');
                return;
            }
            //console.log('Last access: ' + feed.last_access_timestamp);
    
            //proxy.feedXML(db, feed, feed.last_access_timestamp, function(error, xml) {
            res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
            res.end(xml);
        });
    });
});

server.listen(Number(process.argv[2]));

