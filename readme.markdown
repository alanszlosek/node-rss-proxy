Node RSS Proxy
----

Node RSS Proxy is a node.js service I use on my linode server to proxy and cache podcast RSS feeds.

*Why?* To reduce mobile data usage, and so my phone can process RSS feeds more quickly.

* The proxy reduces the size of a podcast feed by omitting unnecessary XML elements
* Reduces the number of servers my phone has to contact when fetching feeds
* Returns only the new feed items (since podcast client's last fetch)
* Follows feed redirects, and remembers previous URLs

Requirements:

* node.js
* NPM modules: See the "npm install" line below

Installation and Usage:

* npm install
* Installs mysql feedparser request entities node-statsd-client
* Create a mysql database
* Use setup.mysql to create tables
* Copy config-example.js to config.js and update with your database credentials and desired secret folder prefix
* Start the service on port 80 via: node ./index.js 80 
* Note: It's probably best to use a higher port so you can run as non-root. Then use port forwarding or configure a proxy in nginx/lighttpd/apache
* When adding feeds to your podcast client, prepend feed URL with: http://YOURDOMAIN.com/FOLDERSECRET-CLIENTNAME/
  * FOLDERSECRET is a secret folder prefix of your choosing, to keep others from using your proxy
  * CLIENTNAME is to differentiate devices/podcast-clients

Note about Caddy HTTP server:

Caddy convert an invalid URL info a valid one, which caused problems for the proxy. Caddy will convert this:

    http://feed-proxy.com/secret-device/http://feed-url.com/123

into this:

    http://feed-proxy.com/secret-device/http/feed-url.com/123

To accomodate that, I've modified src/index.js to expand "http/" into "http://" as appropriate.
