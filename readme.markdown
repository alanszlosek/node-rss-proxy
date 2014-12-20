Node RSS Proxy
----

Node RSS Proxy is a node.js service I use to proxy and cache podcast RSS feeds.

Features:

* Reduces size of a podcast feed by omitting unnecessary XML elements
* Reduces the number of servers my phone has to contact when fetching feeds
* Returns only the new feed items (since podcast client's last fetch)

Requirements:

* node.js
* NPM modules: mysql, feedparser, request, entities

Installation and Usage:

* npm install mysql parse-rss entities
* Create a mysql database
* Use setup.mysql to create tables
* Copy config-example.js to config.js and update with your database credentials and desired secret folder prefix
* Start the service on port 10000 via: node ./index.js 10000
* When adding feeds to your podcast client, prepend feed URL with: http://YOURDOMAIN.com/FOLDERSECRET-CLIENTNAME/
  * FOLDERSECRET is a secret folder prefix of your choosing, to keep others from using your proxy.
  * CLIENTNAME is to differentiate devices/podcast-clients

