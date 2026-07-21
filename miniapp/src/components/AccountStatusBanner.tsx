import { Text, View } from '@tarojs/components';

export default function AccountStatusBanner() {
  return (
    <View className='account-status-banner' role='status'>
      <Text className='account-status-banner__title'>{'\u4f53\u9a8c\u8d26\u53f7'}</Text>
      <Text className='account-status-banner__copy'>{'\u5f53\u524d\u4e3a\u4f53\u9a8c\u8d26\u53f7\u3002\u63d0\u4ea4\u771f\u5b9e\u8d44\u6599\u5e76\u7ecf\u7ba1\u7406\u5458\u5ba1\u6838\u540e\uff0c\u53ef\u4f7f\u7528\u76f8\u5e94\u6b63\u5f0f\u529f\u80fd\u3002'}</Text>
    </View>
  );
}
