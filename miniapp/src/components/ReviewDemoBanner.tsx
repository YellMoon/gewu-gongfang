import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { isReviewExperienceIdentity } from '../utils/reviewExperience';
import './shared.scss';

const REVIEW_TITLE = '\u5ba1\u6838\u4f53\u9a8c';
const REVIEW_COPY = '\u5f53\u524d\u4e3a\u8131\u654f\u793a\u4f8b\u6570\u636e\uff0c\u6838\u5fc3\u4e1a\u52a1\u53ea\u8bfb\uff1b\u7ec4\u5377\u4e0e\u5bfc\u51fa\u4ec5\u5728\u9694\u79bb\u6c99\u7bb1\u4e2d\u8fd0\u884c\u3002';

export default function ReviewDemoBanner() {
  const identity = Taro.getStorageSync('user_info');
  if (!isReviewExperienceIdentity(identity)) return null;

  return (
    <View className='review-demo-banner' role='status'>
      <Text className='review-demo-banner__title'>{REVIEW_TITLE}</Text>
      <Text className='review-demo-banner__copy'>{REVIEW_COPY}</Text>
    </View>
  );
}
