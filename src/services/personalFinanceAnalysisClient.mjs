export const financeWorkerAvailable = () => typeof Worker === 'function';

// One component/session owns this worker. Nothing is persisted or sent over the network.
export function createFinanceAnalysisClient({ createWorker } = {}) {
  let worker, owner, sentLedger, generation = 0, nextId = 0, running, queued, closed = false;
  const cancelled = () => Object.assign(new Error('FINANCE_ANALYSIS_SUPERSEDED'), { code: 'FINANCE_ANALYSIS_SUPERSEDED' });
  const stop = () => {
    worker?.terminate(); worker = undefined; sentLedger = undefined;
    running?.reject(cancelled()); queued?.reject(cancelled()); running = queued = undefined;
  };
  const boot = () => {
    worker = createWorker ? createWorker() : new Worker(/* webpackEntryOptions: { publicPath: "auto" } */ new URL('../workers/personalFinance.worker.ts', import.meta.url), { type: 'module' });
    const activeWorker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== activeWorker || !running || data.id !== running.id) return;
      if (data.phase) { running.progress?.(data.phase); return; }
      const task = running; running = undefined;
      if (data.error) task.reject(Object.assign(new Error(data.error), { code: data.error }));
      else task.resolve(data.result);
      drain();
    };
    worker.onerror = () => { if (worker !== activeWorker) return; const task = running; running = undefined; task?.reject(Object.assign(new Error('FINANCE_ANALYSIS_WORKER_FAILED'), { code: 'FINANCE_ANALYSIS_WORKER_FAILED' })); stop(); };
  };
  const drain = () => {
    if (closed || running || !queued) return;
    if (!worker) boot();
    running = queued; queued = undefined;
    const fresh = sentLedger !== running.ledger;
    if (fresh) { sentLedger = running.ledger; generation++; }
    worker.postMessage({ id: running.id, generation, ...(fresh ? { ledger: running.ledger } : {}), options: running.options });
  };
  return {
    analyze(ledger, options, sessionOwner, progress) {
      if (closed) return Promise.reject(cancelled());
      if (owner !== sessionOwner) { stop(); owner = sessionOwner; }
      queued?.reject(cancelled());
      return new Promise((resolve, reject) => {
        queued = { id: ++nextId, ledger, options, progress, resolve, reject };
        try { drain(); } catch { const task = queued || running; queued = running = undefined; task?.reject(Object.assign(new Error('FINANCE_ANALYSIS_WORKER_FAILED'), { code: 'FINANCE_ANALYSIS_WORKER_FAILED' })); stop(); }
      });
    },
    dispose() { closed = true; stop(); },
  };
}
