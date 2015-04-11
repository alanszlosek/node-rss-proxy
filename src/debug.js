module.exports = function(prefix) {
    return {
        log: function(message) {
            console.log(prefix + ': ' + message);
        },
        error: function(message) {
            console.error(prefix + ': ' + message);
        }
    };
};
