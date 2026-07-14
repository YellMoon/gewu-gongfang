import Taro from '@tarojs/taro';
import {
  AUTH_SESSION_GENERATION_KEY,
  AUTH_SESSION_STATE_KEY,
  createAuthSessionRuntime,
} from './miniappApiSessionRuntime';

export const authSessionRuntime = createAuthSessionRuntime({
  readToken: () => Taro.getStorageSync('auth_token'),
  readIdentity: () => Taro.getStorageSync('user_info'),
  readGeneration: () => Taro.getStorageSync(AUTH_SESSION_GENERATION_KEY),
  writeGeneration: (generation: number) => Taro.setStorageSync(AUTH_SESSION_GENERATION_KEY, generation),
  readSessionState: () => Taro.getStorageSync(AUTH_SESSION_STATE_KEY),
  writeSessionState: (state: any) => Taro.setStorageSync(AUTH_SESSION_STATE_KEY, state),
});

export { AUTH_SESSION_GENERATION_KEY, AUTH_SESSION_STATE_KEY };
