import { Text, View } from '@tarojs/components';

export default function AccountStatusBanner() {
  return (
    <View className='account-status-banner' role='status'>
      <Text className='account-status-banner__title'>{'\u8bbf\u5ba2\u8d26\u53f7'}</Text>
      <Text className='account-status-banner__copy'>{'\u53ef\u63d0\u4ea4\u6559\u5e08\u3001\u5b66\u751f\u6216\u5bb6\u5ead\u6210\u5458\u8eab\u4efd\u7533\u8bf7\u3002\u8eab\u4efd\u751f\u6548\u540e\u53ef\u4f7f\u7528\u5bf9\u5e94\u529f\u80fd\u3002'}</Text>
    </View>
  );
}
