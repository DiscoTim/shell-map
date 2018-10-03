'option strict';

const logSystem = 'shell-map';
require('./exceptionWriter.js')(logSystem);
const Queue = require('better-queue');
const geoip = require('geoip-lite');
const dns = require('dns');

const requestToJSON = require('./requestToJSON.js');
const DefaultNode = require('./defaultNode.js');
const Server = require('./server.js');

const { config } = global;
const { log } = global;

dns.setServers(config.dnsServers);

const nodeTable = new Map();

const globals = {
  networkNodeList: {},
  apiData: {},
  iteration: 0
};

globals.apiData.geoLocations = [];
globals.apiData.arcLocations = {};
globals.apiData.nodeData = {};
globals.apiData.regionData = {};
globals.apiData.countryData = {};
globals.apiData.globalData = {};

globals.server = new Server(globals);

function updateNetworkNodeList() {
  return new Promise((resolve, reject) => {
    requestToJSON(config.networkNodeListJSONurl, config.networkNodeListTimeout).then(
      (response) => {
        if (response.isError) {
          log('warn', logSystem, 'Failed request for %s, reason: %s', [response.url, response.error]);
          reject(response.error);
        } else {
          globals.networkNodeList = response.json;
          log('info', logSystem, 'Updated network node list. Total: %s', [
            globals.networkNodeList.nodes.length
          ]);
          resolve(response);
        }
      }
    );
  });
}

function removeStaleNodes() {
  const dateNowSeconds = Math.round(Date.now() / 1000);
  const removeIds = [];
  nodeTable.forEach((node, key) => {
    if (dateNowSeconds - node.lastUpdate > config.nodeTTL) {
      removeIds.push(key);
    }
  });
  log('info', logSystem, 'Removing stale nodes: %s %j', [removeIds.length, removeIds]);
  removeIds.forEach((key) => {
    nodeTable.delete(key);
  });
}

function filterQueue(task, callback) {
  if (nodeTable.has(task.id) && (nodeTable.get(task.id).iteration === task.iteration)) {
    log('debug', logSystem, 'Filtered: %j', [task]);
    callback('Duplicate Node', task);
  } else {
    callback(null, task);
  }
}

function processQueueItem(task, callback) {
  let defaultNode;
  if (nodeTable.has(task.id)) {
    defaultNode = nodeTable.get(task.id);
  } else {
    defaultNode = new DefaultNode(task.id, task.node.host, task.node.port, config.networkNodeTimeout, 'networkNode');
    nodeTable.set(task.id, defaultNode);
  }

  defaultNode.iteration = task.iteration;

  log('debug', logSystem, 'Processing %j', [task]);
  log('info', logSystem, 'Node count: %s', [nodeTable.size]);

  defaultNode.update().then((result) => {
    callback(null, result);
  }).catch((err) => {
    callback(err);
  });
}

const q = new Queue(processQueueItem,
  {
    concurrent: 25,
    maxRetries: 0,
    retryDelay: 5000,
    filter: filterQueue
  });

function seedQueue() {
  updateNetworkNodeList().then(() => {
    removeStaleNodes();
    globals.iteration += 1;
    Object.values(globals.networkNodeList.nodes).forEach((node) => {
      dns.lookup(node.url, { all: true }, (err, addresses) => {
        if (!err) {
          addresses.forEach((address) => {
            q.push({
              id: `${address.address}:${node.port}`,
              iteration: globals.iteration,
              node: { host: address.address, port: node.port }
            });
          });
        }
      });
    });
  }).catch((err) => {
    log('warn', logSystem, 'Error seeding queue, retrying : %j', [err]);
    setTimeout(seedQueue, 5000);
  });
}

q.on('task_finish', (taskId, result, stats) => {
  log('info', logSystem, 'Task Finished: %s %j', [taskId, stats]);
  log('info', logSystem, 'Queue Stats: %j', [q.getStats()]);
  if (result.peers) {
    log('info', logSystem, 'Found %s nodes', [result.peers.length]);
    result.peers.forEach((peer) => {
      const addressParts = peer.split(':');
      const id = `${addressParts[0]}:${config.rpcPort}`;
      q.push({
        id,
        iteration: globals.iteration,
        node: {
          host: addressParts[0],
          port: config.rpcPort
        }
      });
    });
  }
});

q.on('task_accepted', (taskId, task) => {
  log('debug', logSystem, 'Task accepted: %s %j', [taskId, task]);
});

q.on('task_queued', (taskId, task) => {
  log('debug', logSystem, 'Task queued: %s %j', [taskId, task]);
});

q.on('task_started', (taskId, task) => {
  log('debug', logSystem, 'Task started: %s %j', [taskId, task]);
});

q.on('task_failed', (taskId, err, stats) => {
  log('info', logSystem, 'Task failed: %s %s %j', [taskId, err, stats]);
  log('debug', logSystem, 'Queue Stats: %j', [q.getStats()]);
});

q.on('empty', () => {
  log('info', logSystem, 'Queue is empty');
});

q.on('drain', () => {
  log('info', logSystem, 'Queue is drained');
  log('info', logSystem, 'Reseeding queue in %s seconds', [config.queueReseedDelay]);
  setTimeout(seedQueue, config.queueReseedDelay * 1000);
});

// Function can be optimized
function updateStats() {
  const regionStats = {};
  const countryStats = {};
  const geoLocations = [];
  const nodeStats = {};

  let nodeValidCount = 0;
  let nodeInvalidCount = 0;

  const arcMap = new Map();
  const arcs = {};

  nodeTable.forEach((node) => {
    nodeStats[node.host] = { ...node.feeInfo, ...node.info };

    const geoNode = geoip.lookup(node.host);
    if (!geoNode) {
      log('warn', 'geoip', 'Failed geoip lookup: %s %j', [node.host, node]);
      return;
    }

    let peerMap;
    if (!arcMap.has(node.host)) {
      peerMap = new Map();
      arcMap.set(node.host, peerMap);
    } else {
      peerMap = arcMap.get(node.host);
    }

    node.peers.forEach((peer) => {
      const peerParts = peer.split(':');
      const peerHost = peerParts[0];

      const geoPeer = geoip.lookup(peerHost);
      if (!geoPeer) {
        log('warn', 'geoip', 'Failed geoip peer lookup: %s %j from %s', [peerHost, peer, node.host]);
        return;
      }

      if (!peerMap.has(peerHost)) {
        const arc = {
          origin: {
            host: node.host,
            country: geoNode.country,
            latitude: geoNode.ll[0],
            longitude: geoNode.ll[1]
          },
          destination: {
            host: peerHost,
            country: geoPeer.country,
            latitude: geoPeer.ll[0],
            longitude: geoPeer.ll[1]
          }
        };
        peerMap.set(peerHost, arc);
      }

      let reverseMap;
      if (!arcMap.has(peerHost)) {
        reverseMap = new Map();
        arcMap.set(peerHost, reverseMap);
      } else {
        reverseMap = arcMap.get(peerHost);
      }

      if (!reverseMap.has(node.host)) {
        const reverseArc = {
          origin: {
            host: node.host,
            country: geoNode.country,
            latitude: geoNode.ll[0],
            longitude: geoNode.ll[1]
          },
          destination: {
            host: peerHost,
            country: geoPeer.country,
            latitude: geoPeer.ll[0],
            longitude: geoPeer.ll[1]
          }
        };
        reverseMap.set(node.host, reverseArc);
      }
    });
  });

  arcMap.forEach((node, key) => {
    arcs[key] = [];

    node.forEach((arc) => {
      arcs[key].push(arc);
    });
  });

  nodeTable.forEach((data) => {
    const geo = geoip.lookup(data.host);
    if (!geo) {
      log('warn', 'geoip', 'Failed geoip lookup: %s %j', [data.host, data]);
    }
    let peerCount = 0;
    peerCount = data.peers.length;
    const valid = peerCount > 0;
    const bubbleSize = Math.max(peerCount ** 0.05, 0.5);

    if (data.error) {
      nodeInvalidCount += 1;
    } else {
      nodeValidCount += 1;
    }

    if (geo) {
      const knownByCount = (arcs[data.host] || []).length;

      const marker = {
        name: data.name,
        latitude: geo.ll[0],
        longitude: geo.ll[1],
        radius: bubbleSize,
        valid,
        host: data.host,
        rDNS: data.rDNS,
        peers: peerCount,
        peersKnownBy: knownByCount,
        fee: data.feeInfo.amount,
        region: geo.region,
        country: geo.country,
        city: geo.city,
        lastSeen: data.lastUpdate,
        firstSeen: data.start
      };
      regionStats[geo.region || 'unknown'] = regionStats[geo.region || 'unknown'] + 1 || 1;
      countryStats[geo.country || 'unknown'] = countryStats[geo.country || 'unknown'] + 1 || 1;
      geoLocations.push(marker);
    } else {
      regionStats.unknown = regionStats.unknown + 1 || 1;
      countryStats.unknown = countryStats.unknown + 1 || 1;
    }
  });

  globals.apiData.regionData.stats = [];
  globals.apiData.countryData.stats = [];

  globals.apiData.globalData.nodeCount = nodeTable.size;
  globals.apiData.globalData.nodeValidCount = nodeValidCount;
  globals.apiData.globalData.nodeInvalidCount = nodeInvalidCount;

  geoLocations.sort((a, b) => b.radius - a.radius);
  globals.apiData.geoLocations = geoLocations;

  globals.apiData.nodeData = nodeStats;

  globals.apiData.arcLocations = arcs;

  Object.entries(regionStats).forEach((entry) => {
    globals.apiData.regionData.stats.push({ key: entry[0], value: entry[1] });
  });
  globals.apiData.regionData.stats.sort((a, b) => b.value - a.value);

  Object.entries(countryStats).forEach((entry) => {
    globals.apiData.countryData.stats.push({ key: entry[0], value: entry[1] });
  });
  globals.apiData.countryData.stats.sort((a, b) => b.value - a.value);
}

function backgroundTasks() {
  setInterval(updateStats, config.statsUpdateInterval * 1000);
}

function init() {
  globals.server.start();
  seedQueue();
  backgroundTasks();
}

init();
