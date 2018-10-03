'option strict';

const { log } = global;
const { config } = global;
const logSystem = 'defaultNode';
require('./exceptionWriter.js')(logSystem);

const { Resolver } = require('dns');
const { TurtleCoind } = require('turtlecoin-rpc');

const dns = new Resolver();
dns.setServers(config.dnsServers);

function DefaultNode(name, host, port, timeout, logFile) {
  const dateNowSeconds = () => Math.round(Date.now() / 1000);
  this.logFile = logFile;

  this.name = name;
  this.host = host;
  this.port = port;

  this.timeout = timeout * 1000;
  this.error = false;
  this.lastChange = dateNowSeconds();
  this.lastUpdate = dateNowSeconds();
  this.lastStatus = null;
  this.start = dateNowSeconds();

  this.iteration = 0;
  this.peers = [];
  this.info = {};
  this.feeInfo = {};
  this.rDNS = [];

  Object.defineProperties(this, {
    lastChangeSec: {
      enumerable: true,
      get() {
        return dateNowSeconds() - this.lastChange;
      }
    },
    lastUpdateSec: {
      enumerable: true,
      get() {
        return dateNowSeconds() - this.lastUpdate;
      }
    }
  });

  const daemon = new TurtleCoind({
    host: this.host,
    port: this.port,
    timeout: this.timeout
  });

  this.update = () => new Promise((resolveUpdate, rejectUpdate) => {
    const promiseFeeInfo = new Promise((resolve) => {
      daemon.feeInfo()
        .then((node) => {
          if (node) {
            this.feeInfo = node || {};
          }
          resolve(this);
        }).catch((err) => {
          log('debug', this.logFile, 'Failed to get feeInfo from %s %s:%s, reason: %s', [
            this.name,
            this.host,
            this.port,
            err
          ]);
          resolve(this);
        });
    });

    const promiseGetInfo = new Promise((resolve) => {
      daemon.getInfo()
        .then((node) => {
          if (node) {
            this.info = node || {};
          }
          resolve(this);
        }).catch((err) => {
          log('debug', this.logFile, 'Failed to getInfo from %s %s:%s, reason: %s', [
            this.name,
            this.host,
            this.port,
            err
          ]);
          resolve(this);
        });
    });

    const promiseGetPeers = new Promise((resolve) => {
      daemon.getPeers()
        .then((node) => {
          if (node) {
            this.peers = node.peers || [];
          }
          this.error = false;
          resolve(this);
        })
        .catch((err) => {
          log('debug', this.logFile, 'Failed to get peers from %s %s:%s, reason: %s', [
            this.name,
            this.host,
            this.port,
            err
          ]);
          this.error = true;
          resolve(this);
        });
    });

    const promiseGetRdns = new Promise((resolve) => {
      dns.reverse(this.host, (err, result) => {
        if (err) {
          log('debug', this.logFile, 'Failed reverse lookup %s %s:%s, reason: %s', [
            this.name,
            this.host,
            this.port,
            err
          ]);
        } else {
          this.rDNS = result || [];
        }
        resolve(this);
      });
    });

    Promise.all([
      promiseGetPeers,
      promiseGetInfo,
      promiseFeeInfo,
      promiseGetRdns
    ]).then(() => {
      this.lastUpdate = dateNowSeconds();
      if (this.error) {
        rejectUpdate(new Error('Error updating node'));
      } else {
        resolveUpdate(this);
      }
    });
  });
}

module.exports = DefaultNode;
