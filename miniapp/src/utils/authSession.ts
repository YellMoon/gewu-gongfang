import Taro from '@tarojs/taro';
import {
  AUTH_SESSION_GENERATION_KEY,
  createAuthSessionRuntime,
} from './miniappApiSessionRuntime';

export const authSessionRuntime = createAuthSessionRuntime({
  readToken: () => Taro.getStorageSync('auth_token'),
  readIdentity: () => Taro.getStorageSync('user_info'),
  readGeneration: () => Taro.getStorageSync(AUTH_SESSION_GENERATION_KEY),
  writeGeneration: (generation: number) => Taro.setStorageSync(AUTH_SESSION_GENERATION_KEY, generation),
});

export { AUTH_SESSION_GENERATION_KEY };
