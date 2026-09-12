import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { getCurrentUser } from '../../utils/permission';
import { isVisitorIdentity } from '../../utils/accountExperience';
import './index.scss';

export default function ForbiddenPage() {
  const canApply = isVisitorIdentity(getCurrentUser());
  const handleBack = () => {
    Taro.switchTab({ url: '/pages/index/index' }).catch(() => {
      Taro.navigateBack().catch(() => {
        Taro.redirectTo({ url: '/pages/index/index' });
      });
    });
  };

  return (
    <View className="forbidden-page">
      <View className="forbidden-icon">
        <Text className="icon-mark">限</Text>
      </View>
      <Text className="forbidden-title">{'\u5f53\u524d\u8d26\u53f7\u6682\u4e0d\u80fd\u4f7f\u7528\u6b64\u529f\u80fd'}</Text>
      {/* UTF-8: Explain the existing application path only to eligible applicants. */}
      <Text className="forbidden-desc">{canApply
        ? '请返回首页，在“我的”中提交角色申请，审核通过后可使用对应功能。'
        : '\u8bf7\u8fd4\u56de\u9996\u9875\u67e5\u770b\u53ef\u7528\u529f\u80fd\uff0c\u6216\u5207\u6362\u4e3a\u6709\u6743\u9650\u7684\u8d26\u53f7'}</Text>
      <View className="forbidden-btn" onClick={handleBack}>
        <Text className="btn-text">返回首页</Text>
      </View>
    </View>
  );
}
