function withOperationTimeout(operation, timeoutMs, code, message = code) {
  const duration = Number(timeoutMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    const error = new Error(code);
    error.code = code;
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(message || code);
      error.code = code;
      reject(error);
    }, duration);
    Promise.resolve(operation).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

module.exports = { withOperationTimeout };
