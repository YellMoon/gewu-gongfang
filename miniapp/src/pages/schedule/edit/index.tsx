import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import ReviewDemoBanner from '../../../components/ReviewDemoBanner';
import { isReviewExperienceIdentity } from '../../../utils/reviewExperience';
import './edit.scss';

export default function ScheduleEdit() {
  const isReviewDemo = isReviewExperienceIdentity(Taro.getStorageSync('user_info'));
  return (
    <View className="se-container">
      <ReviewDemoBanner />
      <View className="se-field">
        {isReviewDemo ? <Text className="se-value">{'\u5ba1\u6838\u4f53\u9a8c\u4e2d\u4e0d\u53ef\u7f16\u8f91\u6392\u8bfe\uff1b\u5f53\u524d\u4ec5\u5c55\u793a\u8131\u654f\u793a\u4f8b\u8bfe\u7a0b\u3002'}</Text> : null}
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
