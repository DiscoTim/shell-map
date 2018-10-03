'option strict';

const fs = require('fs');
const util = require('util');
const dateFormat = require('dateformat');
const clc = require('cli-color');

const { config } = global;
const severityLevels = ['debug', 'info', 'warn', 'error'];
const logDir = config.logging.files.directory;
const pendingWrites = {};

const severityMap = {
  debug: clc.white,
  info: clc.blue,
  warn: clc.yellow,
  error: clc.red
};

if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir);
  } catch (e) {
    throw e;
  }
}

setInterval(() => {
  Object.keys(pendingWrites).forEach((fileName) => {
    const data = pendingWrites[fileName];
    fs.appendFile(fileName, data, (err) => {
      // eslint-disable-next-line no-console
      if (err) console.log(err);
    });
    delete pendingWrites[fileName];
  });
}, config.logging.files.flushInterval * 1000);

global.log = (severity, system, text, data) => {
  const logConsole = severityLevels.indexOf(severity)
    >= severityLevels.indexOf(config.logging.console.level);
  const logFiles = severityLevels.indexOf(severity)
    >= severityLevels.indexOf(config.logging.files.level);

  let formattedMessage = text;

  if (!logConsole && !logFiles) return;

  const time = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');

  if (data) {
    data.unshift(text);
    formattedMessage = util.format.apply(null, data);
  }

  if (logConsole) {
    if (config.logging.console.colors) {
      // eslint-disable-next-line no-console
      console.log(
        `${severityMap[severity](time)}${clc.white.bold(` [${system}] `)}${formattedMessage}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`${time} [${system}] ${formattedMessage}`);
    }
  }

  if (logFiles) {
    const fileName = `${logDir}/${system}_${severity}.log`;
    const fileLine = `${time} ${formattedMessage}\n`;
    pendingWrites[fileName] = (pendingWrites[fileName] || '') + fileLine;
  }
};
