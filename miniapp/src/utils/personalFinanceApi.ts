import Taro from '@tarojs/taro';
import { authSessionRuntime } from './authSession';
// @ts-ignore Shared session fence is tested independently.
import { createPersonalFinanceTransport } from './personalFinanceTransport';
declare const __CLOUD_BUSINESS_API_BASE_URL__: string | undefined;
const baseUrl = typeof __CLOUD_BUSINESS_API_BASE_URL__ !== 'undefined' && __CLOUD_BUSINESS_API_BASE_URL__ ? __CLOUD_BUSINESS_API_BASE_URL__ : 'https://physicsedu.xyz/cloud-business';
const request = createPersonalFinanceTransport({ capture: () => authSessionRuntime.capture(), isSameSession: (session: any) => authSessionRuntime.isSameSession(session), request: (input: any) => Taro.request(input), baseUrl });
export const personalFinanceApi = {
  ledger: () => request('/ledger'),
  preview: (input: any) => request('/imports/preview', 'POST', input),
  import: (input: any, key: string) => request('/imports', 'POST', input, key),
};
