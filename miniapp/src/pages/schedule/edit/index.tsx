import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './edit.scss';

export default function ScheduleEdit() {
  return (
    <View className="se-container">
      <View className="se-field">
        <Text className="se-label">排课编辑</Text>
        <Text className="se-value">
          微信小程序端不提供排课新增和编辑。请在电脑端完成排课管理。
        </Text>
      </View>

      <View className="se-submit" onClick={() => Taro.navigateBack()}>
        <Text className="se-submit-text">返回</Text>
      </View>
    </View>
  );
}
