import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './edit.scss';

export default function ScheduleEdit() {
  return (
    <View className='se-container'>
      <View className='se-field'>
        <Text className='se-label'>{'\u6392\u8bfe\u7f16\u8f91'}</Text>
        <Text className='se-value'>{'\u5fae\u4fe1\u5c0f\u7a0b\u5e8f\u7aef\u4e0d\u63d0\u4f9b\u6392\u8bfe\u65b0\u589e\u548c\u7f16\u8f91\u3002\u8bf7\u5728\u7535\u8111\u7aef\u5b8c\u6210\u6392\u8bfe\u7ba1\u7406\u3002'}</Text>
      </View>
      <View className='se-submit' onClick={() => Taro.navigateBack()}><Text className='se-submit-text'>{'\u8fd4\u56de'}</Text></View>
    </View>
  );
}
