// @ts-ignore The same exact-integer rules run in desktop, miniapp and cloud.
import { prepareFinanceView } from '../../shared/personal-finance/ledger.js';
// @ts-ignore This is read-only evidence registration.
import { buildAssetRegister } from '../../shared/personal-finance/assetRegister.js';

const channel = self as any;
let ledger: any, generation: number, full: any, register: any, project: any;
const cached = new Map<string, any>();
channel.onmessage = ({ data }: MessageEvent) => {
  const { id, options = {} } = data;
  try {
    if (data.ledger) { ledger = data.ledger; generation = data.generation; full = register = project = undefined; cached.clear(); }
    if (!ledger || generation !== data.generation) throw new Error('FINANCE_ANALYSIS_INPUT_CHANGED');
    const key = JSON.stringify([options.accountIds ? [...new Set(options.accountIds)].sort() : null, options.startDate ?? null, options.endDate ?? null]);
    if (!full) {
      channel.postMessage({ id, phase: 'history' });
      project = prepareFinanceView(ledger);
      full = project({});
      channel.postMessage({ id, phase: 'accounts' });
      register = buildAssetRegister(ledger);
    }
    let view = cached.get(key);
    if (!view) {
      channel.postMessage({ id, phase: 'scope' });
      view = Object.keys(options).length ? project(options) : full;
      if (cached.size >= 2) cached.delete(cached.keys().next().value);
      cached.set(key, view);
    }
    channel.postMessage({ id, result: { view, assetRegister: register, globalReview: full.review } });
  } catch (error) {
    // Do not emit raw original data or credentials in an error.
    channel.postMessage({ id, error: 'FINANCE_ANALYSIS_FAILED' });
  }
};
