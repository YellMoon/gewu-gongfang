/**
 * 教学工具 — 小程序端
 * 从服务端插件注册中心获取工具列表
 * 显示工具参数配置表单 → 提交到服务端 → 展示结果
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

interface ToolInfo {
  id: string;
  name: string;
  version: string;
  type: string;
  icon?: string;
  description?: string;
  author?: string;
  parameters?: any;
  platform: {
    desktop: boolean;
    miniprogram: 'full' | 'readonly' | 'none';
    mobile: boolean;
  };
}

const ICON_MAP: Record<string, string> = {
  SoundOutlined: '🔊',
  BarChartOutlined: '📊',
  AimOutlined: '🎯',
  ExperimentOutlined: '🧪',
  ToolOutlined: '🔧',
};

const ToolsPage: React.FC = () => {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);

  // 获取工具列表
  useEffect(() => {
    const fetchTools = async () => {
      setLoading(true);
      try {
        const baseUrl = Taro.getStorageSync('scheduling_api_base_url') || 'http://39.106.172.132';
        const token = Taro.getStorageSync('auth_token');

        const res = await Taro.request({
          url: `${baseUrl}/api/teaching-tools/tools`,
          method: 'GET',
          header: {
            'Authorization': token ? `Bearer ${token}` : '',
          },
          timeout: 10000,
        });

        if (res.statusCode === 200 && res.data?.code === 0) {
          const list = res.data.data.tools || [];
          // 只显示 miniprogram != 'none' 的工具
          const filtered = list.filter(
            (t: ToolInfo) => t.platform?.miniprogram && t.platform.miniprogram !== 'none'
          );
          setTools(filtered);
        }
      } catch (err) {
        console.error('获取工具列表失败:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTools();
  }, []);

  const handleToolClick = (tool: ToolInfo) => {
    Taro.navigateTo({
      url: `/pages/tools/detail?id=${tool.id}&name=${encodeURIComponent(tool.name)}`,
    });
  };

  return (
    <View className='tools-page'>
      {loading ? (
        <View className='loading'>
          <Text>加载教学工具...</Text>
        </View>
      ) : tools.length === 0 ? (
        <View className='empty-state'>
          <Text className='empty-icon'>🧰</Text>
          <Text className='empty-text'>暂无可用教学工具</Text>
          <Text className='empty-hint'>
            请先在桌面端「教学工具」页面点击"同步到服务器"
          </Text>
        </View>
      ) : (
        <View className='tool-list'>
          {tools.map(tool => (
            <View
              key={tool.id}
              className='tool-card'
              onClick={() => handleToolClick(tool)}
            >
              <View className='tool-icon'>
                <Text>{ICON_MAP[tool.icon || ''] || '🔧'}</Text>
              </View>
              <View className='tool-info'>
                <Text className='tool-name'>{tool.name}</Text>
                <Text className='tool-desc'>{tool.description}</Text>
              </View>
              <View className='tool-meta'>
                <Text className='tool-version'>v{tool.version}</Text>
                <Text className='tool-arrow'>›</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

export default ToolsPage;
