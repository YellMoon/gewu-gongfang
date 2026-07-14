import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import ReviewDemoBanner from '../../components/ReviewDemoBanner';
import './index.scss';

export default function ForbiddenPage() {
  const handleBack = () => {
    Taro.switchTab({ url: '/pages/index/index' }).catch(() => {
      Taro.navigateBack().catch(() => {
        Taro.redirectTo({ url: '/pages/index/index' });
      });
    });
  };

  return (
    <View className="forbidden-page">
      <ReviewDemoBanner />
      <View className="forbidden-icon">
        <Text className="icon-mark">限</Text>
      </View>
      <Text className="forbidden-title">暂无权限访问此功能</Text>
      <Text className="forbidden-desc">请联系管理员获取权限</Text>
      <View className="forbidden-btn" onClick={handleBack}>
        <Text className="btn-text">返回首页</Text>
      </View>
    </View>
  );
}
