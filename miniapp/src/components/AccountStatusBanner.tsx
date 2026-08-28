import { Text, View } from '@tarojs/components';

export default function AccountStatusBanner() {
  return (
    <View className='account-status-banner' role='status'>
      <Text className='account-status-banner__title'>{'\u5173\u8054\u8eab\u4efd'}</Text>
      <Text className='account-status-banner__copy'>{'\u53ef\u7533\u8bf7\u5173\u8054\u8001\u5e08\u3001\u5b66\u751f\u6216\u5bb6\u5ead\u6210\u5458\u3002'}</Text>
    </View>
  );
}
