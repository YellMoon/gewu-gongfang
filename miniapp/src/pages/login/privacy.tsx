import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import './privacy.scss';

export default function PrivacyPage() {
  return <View className="privacy-page">
    <View className="privacy-header">
      <Button className="privacy-back" onClick={() => Taro.navigateBack()}>{'<'}</Button>
      <Text className="privacy-title">{'\u9690\u79c1\u4fdd\u62a4\u6307\u5f15'}</Text>
      <View className="privacy-title-placeholder" />
    </View>
    <View className="privacy-content">
      <View className="privacy-section">
        <Text className="privacy-section-title">{'\u4e00\u3001\u4fe1\u606f\u6536\u96c6'}</Text>
        <Text className="privacy-section-text">{'\u6211\u4eec\u5728\u60a8\u767b\u5f55\u6216\u63d0\u4ea4\u8eab\u4efd\u7533\u8bf7\u65f6\u5904\u7406\u5fae\u4fe1\u767b\u5f55\u51ed\u8bc1\u3001\u7ecf\u6388\u6743\u7684\u624b\u673a\u53f7\u548c\u8eab\u4efd\u7533\u8bf7\u8d44\u6599\uff0c\u7528\u4e8e\u5efa\u7acb\u6216\u6838\u5bf9\u4e91\u7aef\u8d26\u53f7\u5173\u7cfb\u3002'}</Text>
      </View>
      <View className="privacy-section">
        <Text className="privacy-section-title">{'\u4e8c\u3001\u4fe1\u606f\u4f7f\u7528'}</Text>
        <Text className="privacy-section-text">{'\u8fd9\u4e9b\u4fe1\u606f\u4ec5\u7528\u4e8e\u8eab\u4efd\u9a8c\u8bc1\u3001\u8d26\u53f7\u5408\u5e76\u3001\u89d2\u8272\u7533\u8bf7\u5ba1\u6838\u548c\u7cfb\u7edf\u5b89\u5168\u9632\u62a4\uff1b\u8bbf\u5ba2\u4e0d\u4f1a\u56e0\u6b64\u83b7\u5f97\u6838\u5fc3\u6559\u52a1\u6216\u8d22\u52a1\u6570\u636e\u8bbf\u95ee\u6743\u9650\u3002'}</Text>
      </View>
      <View className="privacy-section">
        <Text className="privacy-section-title">{'\u4e09\u3001\u4fe1\u606f\u5171\u4eab\u4e0e\u4fdd\u62a4'}</Text>
        <Text className="privacy-section-text">{'\u6211\u4eec\u4e0d\u4f1a\u51fa\u552e\u4e2a\u4eba\u4fe1\u606f\u3002\u9664\u975e\u83b7\u5f97\u60a8\u7684\u660e\u786e\u540c\u610f\u6216\u6cd5\u5f8b\u6cd5\u89c4\u8981\u6c42\uff0c\u4e0d\u4f1a\u5411\u7b2c\u4e09\u65b9\u62ab\u9732\uff1b\u4e91\u7aef\u670d\u52a1\u91c7\u7528\u8bbf\u95ee\u63a7\u5236\u548c\u4f20\u8f93\u4fdd\u62a4\u63aa\u65bd\u9650\u5236\u6570\u636e\u4f7f\u7528\u8303\u56f4\u3002'}</Text>
      </View>
      <View className="privacy-section">
        <Text className="privacy-section-title">{'\u56db\u3001\u60a8\u7684\u6743\u5229'}</Text>
        <Text className="privacy-section-text">{'\u60a8\u53ef\u4ee5\u9000\u51fa\u5f53\u524d\u767b\u5f55\u4f1a\u8bdd\uff1b\u5982\u9700\u67e5\u8be2\u3001\u66f4\u6b63\u6216\u5220\u9664\u4e0e\u8d26\u53f7\u76f8\u5173\u7684\u4fe1\u606f\uff0c\u8bf7\u8054\u7cfb\u670d\u52a1\u63d0\u4f9b\u65b9\u5e76\u8bf4\u660e\u60a8\u7684\u767b\u5f55\u624b\u673a\u53f7\u6216\u8eab\u4efd\u7533\u8bf7\u8bb0\u5f55\u3002'}</Text>
      </View>
      <View className="privacy-section">
        <Text className="privacy-section-title">{'\u4e94\u3001\u6307\u5f15\u66f4\u65b0'}</Text>
        <Text className="privacy-section-text">{'\u672c\u6307\u5f15\u66f4\u65b0\u540e\u4f1a\u5728\u5c0f\u7a0b\u5e8f\u5185\u516c\u5e03\uff1b\u91cd\u5927\u53d8\u5316\u4f1a\u5728\u767b\u5f55\u6216\u76f8\u5173\u529f\u80fd\u5165\u53e3\u660e\u786e\u63d0\u793a\u3002'}</Text>
      </View>
      <Text className="privacy-update-note">{'\u672c\u6307\u5f15\u751f\u6548\u65e5\u671f\uff1a2026\u5e747\u670821\u65e5'}</Text>
    </View>
  </View>;
}
