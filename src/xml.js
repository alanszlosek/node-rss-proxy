var entities = require('entities');

// First param is name, the rest are children
module.exports = function() {
    var args = Array.prototype.slice.call(arguments);
    // Make new object
    var self = {
        _tag: args.shift(),
        _attributes: {},
        _children: args,
        _cdata: null,

        toString: function(declaration) {
            var tag = self._tag,
                xml = '',
                value;
            if (declaration) {
                // What type of declaration?
                if (declaration == 'rss') {
                    xml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/" xmlns:admin="http://webns.net/mvcb/" xmlns:atom="http://www.w3.org/2005/Atom/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">';
                } else {
                    xml = '<?xml version="1.0" encoding="UTF-8"?>';
                }
            }
            xml += '<' + tag;
            for (var i in self._attributes) {
                if (self._attributes.hasOwnProperty(i)) {
                    try {
                        xml += ' ' + i + '="' + entities.encodeXML(self._attributes[i]) + '"';
                    } catch (e) {
                        console.log('Encoding ' + self._attributes[i] + ': ' + e);
                        return '';
                    }
                }
            }
            if (self._cdata) {
                xml += '><![CDATA[' + self._cdata + ']]></' + tag + '>';
            } else if (self._children.length > 0) {
                xml += '>';
                for (var i = 0; i < self._children.length; i++) {
                    var child = self._children[i];
                    if (child) {
                        if (typeof child == 'string') {
                            xml += entities.encodeXML(child);
                        } else {
                            xml += child.toString();
                        }
                    }
                }
                xml += '</' + tag + '>';
            } else {
                xml += ' />';
            }
            if (declaration) {
                // What type of declaration?
                if (declaration == 'rss') {
                    xml += '</rss>';
                }
            }
            return xml;
        },

        // attribute
        attributes: function(attributes) {
            self._attributes = attributes;
            return self;
        },
        attribute: function(name, value) {
            self._attributes[name] = value;
            return self;
        },
        children: function() {
            for (var i = 0; i < arguments.length; i++) {
                self.child(arguments[i]);
            }
            return self;
        },
        child: function(child) {
            self._children.push(child);
            return self;
        },
        cdata: function(text) {
            self._cdata = text;
            return self;
        }
    };
    return self;
};
