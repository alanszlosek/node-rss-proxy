Node RSS Proxy
----

Node RSS Proxy is a node.js service I use to proxy and cache podcast RSS feeds.

Features:

* Reduces size of a podcast feed by omitting unnecessary XML elements
* Reduces the number of servers my phone has to contact when fetching feeds
* Returns only the new feed items (since podcast client's last fetch)

Requirements:

* node.js
* NPM modules: See the "npm install" line below

Installation and Usage:

* npm install mysql feedparser request entities debug
* Create a mysql database
* Use setup.mysql to create tables
* Copy config-example.js to config.js and update with your database credentials and desired secret folder prefix
* Start the service on port 80 via: node ./index.js 80 
  * If you want to see debugging messages, start with : DEBUG=\* node ./index.js 80
* Note: It's probably best to use a higher port so you can run as non-root. Then use port forwarding or configure a proxy in nginx/lighttpd/apache
* When adding feeds to your podcast client, prepend feed URL with: http://YOURDOMAIN.com/FOLDERSECRET-CLIENTNAME/
  * FOLDERSECRET is a secret folder prefix of your choosing, to keep others from using your proxy
  * CLIENTNAME is to differentiate devices/podcast-clients

