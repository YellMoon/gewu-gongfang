'use strict';

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

function sleep(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function retryTransientNetwork(operation, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 2000;
  const wait = options.sleep || sleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!TRANSIENT_NETWORK_CODES.has(error?.code) || attempt >= retries) {
        throw error;
      }
      await wait(delayMs * (attempt + 1));
    }
  }
}

module.exports = {
  retryTransientNetwork,
};
