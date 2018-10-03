'option strict';

const { log } = global;
const logSystem = 'requestToJSON';

const request = require('request');
const zlib = require('zlib');
require('./exceptionWriter.js')(logSystem);

function requestToJSON(url, timeout) {
  const options = {
    url,
    timeout: timeout * 1000,
    strictSSL: false,
    encoding: null,
    headers: { 'accept-encoding': 'gzip,deflate' }
  };

  return new Promise((resolve) => {
    request(options, (err, response, body) => {
      const jsonResponse = { json: undefined, isError: false, error: undefined };
      let decompressedBody;

      jsonResponse.url = url;

      if (err !== null) {
        log('debug', logSystem, 'Failed request for %s, reason: %s', [url, err]);
        jsonResponse.json = undefined;
        jsonResponse.isError = true;
        jsonResponse.error = err;
        jsonResponse.error.url = url;
        resolve(jsonResponse);
        return;
      }

      try {
        switch (response.headers['content-encoding']) {
          case 'deflate':
            decompressedBody = zlib.inflateRawSync(body).toString();
            break;
          case 'gzip':
            decompressedBody = zlib.gunzipSync(body).toString();
            break;
          default:
            decompressedBody = body;
        }

        jsonResponse.json = JSON.parse(decompressedBody);
        resolve(jsonResponse);
      } catch (errRequest) {
        log('debug', logSystem, 'Failed request for %s, reason: %s', [url, err]);
        jsonResponse.json = undefined;
        jsonResponse.isError = true;
        jsonResponse.error = errRequest;
        jsonResponse.error.url = url;
        resolve(jsonResponse);
      }
    });
  });
}

module.exports = requestToJSON;
