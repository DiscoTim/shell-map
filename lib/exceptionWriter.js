'option strict';

const { config } = global;
const fs = require('fs');
const cluster = require('cluster');
const dateFormat = require('dateformat');

module.exports = function uncaughtException(logSystem) {
  process.on('uncaughtException', (err) => {
    const time = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    // eslint-disable-next-line no-console
    console.log(`\n${err.stack}\n`);
    fs.appendFile(`${config.logging.files.directory}/${logSystem}_crash.log`, `${time}\n${err.stack}\n\n`, () => {
      if (cluster.isWorker) { process.exit(); }
    });
  });
};
