'use strict';
/*
Copyright (c) 2013

Dave Williamson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

var fs = require('graceful-fs');
var os = require('os');
var proxywrap = require('findhit-proxywrap');
var http = require('http');
// var https = require('https');

var switchUser = function (_self) {

    var user = _self.config.exUser;

    try {

        process.setgid(user.targetGroup);
        _self.config.logger.info('     Application Switched to GROUP:'.green + (String(user.targetGroup)).blue);
        try {
            process.setuid(user.targetUser);
            _self.config.logger.info('     Application Switched to USER:'.green + (String(user.targetUser)).blue);
        } catch (err) {
            console.error('###### Failed to set UID: ' + err + ' ######');
            console.error('###### PROCESS COULD STILL BE RUNNING AS ROOT ######');
            throw new Error('Security violation!');
        }

    } catch (err) {
        console.error('###### Failed to set GID: ' + err + ' ######');
        console.error('###### PROCESS COULD STILL BE RUNNING AS ROOT ######');
        throw new Error('Security violation!');
    }
};

module.exports = function (_self) {

    return function (err) {

        if (err) {

            _self.config.logger.info('Shutting down, as initialisation code failed: ' + err);
            return _self.config.shutdown();

        }

        _self.config.server = (_self.config.proxyProtocol ? (proxywrap.proxy(http, _self.config.proxyProtocolConfig)).createServer(_self.config.app) : _self.config.http.createServer(_self.config.app));

        if (_self.config.socketio) {
            _self.config.sioObj = _self.config.socketio(_self.config.server);
        }

        if (_self.config.spdyEnabled) {

            if (_self.config.spdyOptions.keyFile) {
                try {
                    _self.config.spdyOptions.key = fs.readFileSync(_self.config.spdyOptions.keyFile);
                } catch (e) {
                    throw new Error('Error reading SSL private key: ' + e);
                }
            } else {
                throw new Error('SPDY requires a valid Private Key file to be specified');
            }

            if (_self.config.spdyOptions.certFile) {
                try {
                    _self.config.spdyOptions.cert = fs.readFileSync(_self.config.spdyOptions.certFile);
                } catch (e) {
                    throw new Error('Error reading SSL certificate: ' + e);
                }
            } else {
                throw new Error('SPDY requires a valid Certificate file to be specified');
            }

            if (_self.config.spdyOptions.caFile) {
                try {
                    _self.config.spdyOptions.ca = fs.readFileSync(_self.config.spdyOptions.caFile);
                } catch (e) {
                    _self.config.logger.warn('CA file specified but could not be read: ' + e);
                }
            } else {
                _self.config.logger.warn('No certificate CA file specified - this may cause problems');
            }

            _self.config.spdy = _self.config.spdy || require('spdy');

            _self.config.spdyServer = _self.config.spdyServer || (_self.config.proxyProtocol ? (proxywrap.proxy(_self.config.spdy.server, _self.config.proxyProtocolConfig)).createServer(_self.config.spdyOptions, _self.config.app) : _self.config.spdy.createServer(_self.config.spdyOptions, _self.config.app));

            if (_self.config.proxyProtocol) {

                _self.config.server.on('connection', function (socket) {
                    socket.on('error', function (err) {
                        _self.config.logger.warn('HTTP Error from server connection from client:' + socket.remoteAddress, err.stack);
                    });
                });
                if (_self.config.spdyEnabled)  {
                    _self.config.spdyServer.on('connection', function (socket) {
                        socket.on('error', function (err) {
                            _self.config.logger.warn('HTTPS Error from server connection from client:' + socket.remoteAddress, err.stack);
                        });
                    });
                }
            }
        }

        _self.config.server.listen(_self.config.port || 3000, _self.config.address || '', function () {

            if (_self.config.memwatch.enabled) {
                _self.config.memwatch.fn.gc();
                _self.config.memwatch.initialHeap = new _self.config.memwatch.fn.HeapDiff();
            }

            _self.config.logger.info('');
            _self.config.logger.info((_self.config.name + ' Status').underline.bold.yellow);
            _self.config.logger.info('');
            _self.config.logger.info('     NodeJS Version: '.green + (String(process.version)).blue);
            _self.config.logger.info('     Process Name (pid): '.green + (process.title + ' (' + process.pid + ')').blue);
            _self.config.logger.info('     Architecture: '.green + (String(process.arch)).blue);
            _self.config.logger.info('     Platform: '.green + (String(process.platform)).blue);
            _self.config.logger.info('     Memwatch Enabled: '.green + ((_self.config.memwatch && _self.config.memwatch.enabled ? 'Yes' : 'No')).bold.blue);
            _self.config.logger.info('     Uses Proxy Protocol: '.green + (_self.config.proxyProtocol ? 'Yes' : 'No').blue);
            if (_self.config.proxyProtocol) {
                _self.config.logger.info('     +- Strict Proxy Protocol: '.green + (_self.config.proxyProtocolConfig.strict ? 'Yes' : 'No').blue);
            }
            _self.config.logger.info('     HTTP Listening on port: '.green + (String(_self.config.address + ':' + _self.config.port)).bold.blue);

            if (_self.config.spdyEnabled) {
                if (_self.config.socketio) {
                    _self.config.secureSioObj = _self.config.socketio(_self.config.spdyServer);
                }
                _self.config.spdyServer.listen(_self.config.spdyPort, _self.config.address, function () {
                    clearTimeout(_self.startTimer);
                    _self.config.logger.info('     SPDY Listening on port: '.green + (String(_self.config.address + ':' + _self.config.spdyPort)).bold.blue);
                    _self.config.logger.info('     SPDY Certificate: '.green + (String(_self.config.spdyOptions.certFile)).bold.blue);
                    _self.config.logger.info('     Environment: '.green + (String(_self.config.app.get('env'))).bold.blue);
                    _self.config.logger.info('     Version: '.green + (String(_self.config.app.get('version'))).blue);
                    _self.config.logger.info('     OS Total Memory: '.green + (parseInt(os.totalmem() / 1048576, 10) + ' MB').blue);
                    _self.config.logger.info('     OS Free Memory: '.green + (parseInt(os.freemem() / 1048576, 10) + ' MB').blue);
                    _self.config.logger.info('     Heap Total: '.green + (parseInt(process.memoryUsage().heapTotal / 1048576, 10) + ' MB').blue);
                    _self.config.logger.info('     Heap Used: '.green + (parseInt(process.memoryUsage().heapUsed / 1048576, 10) + ' MB').blue);
                    _self.config.logger.info('     Memory Used: '.green + (parseInt(process.memoryUsage().rss / 1048576, 10) + ' MB').blue);
                    _self.config.logger.info('     External Used: '.green + (parseInt(process.memoryUsage().external / 1048576, 10) + ' MB').blue);
                    // _self.config.logger.info('     Application Started'.blue);
                    if (_self.config.exUser && _self.config.exUser.switchOnReady)
                        {switchUser(_self);}
                    _self.config.logger.info('');
                    _self.config.sendMessage('online');
                    if (typeof _self.onReady === 'function')
                        {_self.onReady();}
                }
                );
            } else {
                clearTimeout(_self.startTimer);
                _self.config.logger.info('     Environment: '.green + (String(_self.config.app.get('env'))).bold.blue);
                _self.config.logger.info('     Version: '.green + (String(_self.config.app.get('version'))).blue);
                _self.config.logger.info('     OS Total Memory: '.green + (parseInt(os.totalmem() / 1048576, 10) + ' MB').blue);
                _self.config.logger.info('     OS Free Memory: '.green + (parseInt(os.freemem() / 1048576, 10) + ' MB').blue);
                _self.config.logger.info('     Heap Total: '.green + (parseInt(process.memoryUsage().heapTotal / 1048576, 10) + ' MB').blue);
                _self.config.logger.info('     Heap Used: '.green + (parseInt(process.memoryUsage().heapUsed / 1048576, 10) + ' MB').blue);
                _self.config.logger.info('     Memory Used: '.green + (parseInt(process.memoryUsage().rss / 1048576, 10) + ' MB').blue);
                _self.config.logger.info('     External Used: '.green + (parseInt(process.memoryUsage().external / 1048576, 10) + ' MB').blue);
                // _self.config.logger.info('     Application Started'.blue);

                if (_self.config.exUser && _self.config.exUser.switchOnReady) {
                    switchUser(_self);
                }

                _self.config.logger.info('');

                _self.config.sendMessage('online');

                if (typeof _self.onReady === 'function') {
                    _self.onReady();
                }
            }
        });
    };
};
