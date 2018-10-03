'option strict';

const logSystem = 'server';
require('./exceptionWriter.js')(logSystem);
const express = require('express');

const { config } = global;
const { log } = global;

function Server(globals) {
  function apiHandler(req, res) {
    const { apiData } = globals;

    if (req.params.param && req.params.param === 'arcs' && req.params.host) {
      if (globals.apiData.arcLocations && globals.apiData.arcLocations[req.params.host]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify(globals.apiData.arcLocations[req.params.host]));
        res.end();
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.write('Invalid request\n');
        res.end();
      }
    } else if (req.params.param && req.params.param === 'node' && req.params.host) {
      if (globals.apiData.nodeData && globals.apiData.nodeData[req.params.host]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify(globals.apiData.nodeData[req.params.host]));
        res.end();
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.write('Invalid request\n');
        res.end();
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(JSON.stringify({
        geoLocations: apiData.geoLocations,
        regionData: apiData.regionData,
        countryData: apiData.countryData,
        globalData: apiData.globalData
      }));
      res.end();
    }
  }

  function onListening(err) {
    if (err) {
      log('info', logSystem, 'Error starting server: %s', [err]);
    } else {
      log('info', logSystem, 'Server started and listening on %s:%s', [config.serverHost, config.serverPort]);
    }
  }

  this.start = () => {
    const expressServer = express();

    const options = {
      index: 'index.html'
    };

    expressServer.use('/', express.static('html', options));

    expressServer.get('/api/stats/:param(arcs)/:host', apiHandler);
    expressServer.get('/api/stats/:param(node)/:host', apiHandler);
    expressServer.get('/api/stats', apiHandler);

    expressServer.listen(config.serverPort, config.serverHost, onListening);
  };
}

module.exports = Server;
