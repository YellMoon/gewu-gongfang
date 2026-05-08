/**
 * 教学工具 — 参数配置 + 结果渲染 v2
 * 支持: 参数表单 → 服务端执行 → 可视化渲染
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Picker, Slider, Button, ScrollView, Input, Canvas } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './detail.scss';

interface ParamField {
  type: string;
  title?: string;
  description?: string;
  default?: any;
  minimum?: number;
  maximum?: number;
  step?: number;
  enum?: string[];
  enumNames?: string[];
}

interface ToolSchema {
  id: string;
  name: string;
  description?: string;
  miniprogramMode: 'full' | 'readonly' | 'none';
  parameters?: { type: string; properties: Record<string, ParamField>; required?: string[] };
}

interface WaveResult {
  type: string;
  waveType: string;
  metadata: Record<string, any>;
  data: { x: number; y: number }[];
  renderHint?: { viewport: { x: number[]; y: number[] } };
}

const DetailPage: React.FC = () => {
  const [schema, setSchema] = useState<ToolSchema | null>(null);
  const [params, setParams] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<WaveResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const router = Taro.getCurrentInstance()?.router;
  const toolId = router?.params?.id || '';
  const toolName = decodeURIComponent(router?.params?.name || '工具');

  useEffect(() => {
    if (toolId) fetchSchema();
  }, [toolId]);

  const fetchSchema = async () => {
    setLoading(true);
    try {
      const baseUrl = Taro.getStorageSync('scheduling_api_base_url') || 'http://39.106.172.132';
      const token = Taro.getStorageSync('auth_token');
      const res = await Taro.request({
        url: `${baseUrl}/api/teaching-tools/tools/${toolId}/schema`,
        method: 'GET',
        header: { 'Authorization': token ? `Bearer ${token}` : '' },
        timeout: 10000,
      });

      if (res.statusCode === 200 && res.data?.code === 0) {
        const s = res.data.data as ToolSchema;
        setSchema(s);
        if (s.parameters?.properties) {
          const defaults: Record<string, any> = {};
          Object.entries(s.parameters.properties).forEach(([key, prop]) => {
            if (prop.default !== undefined) defaults[key] = prop.default;
          });
          setParams(defaults);
        }
      }
    } catch {
      Taro.showToast({ title: '获取工具参数失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const renderControl = (key: string, field: ParamField) => {
    const value = params[key] ?? field.default;

    switch (field.type) {
      case 'string':
        if (field.enum) {
          const idx = field.enum.indexOf(value);
          return (
            <Picker mode='selector' range={field.enumNames || field.enum} value={idx >= 0 ? idx : 0}
              onChange={e => { const i = Number(e.detail.value as string); setParams({...params, [key]: field.enum![i]}); }}>
              <View className='pv'><Text>{(field.enumNames || field.enum)[idx >= 0 ? idx : 0]}</Text><Text className='pa'>▼</Text></View>
            </Picker>
          );
        }
        return <Input className='pi' value={String(value || '')} onInput={e => setParams({...params, [key]: e.detail.value})} placeholder={field.title || key} />;

      case 'number': {
        const min = field.minimum ?? 0, max = field.maximum ?? 100, step = field.step ?? 1;
        return (
          <View className='sg'>
            <Slider min={min} max={max} step={step} value={value ?? min} activeColor='#1890ff' backgroundColor='#e8e8e8' blockSize={20}
              onChange={e => setParams({...params, [key]: e.detail.value})} />
            <Text className='sv'>{value ?? min}</Text>
          </View>
        );
      }
      default: return <Text className='un'>不支持类型: {field.type}</Text>;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const baseUrl = Taro.getStorageSync('scheduling_api_base_url') || 'http://39.106.172.132';
      const token = Taro.getStorageSync('auth_token');
      const res = await Taro.request({
        url: `${baseUrl}/api/teaching-tools/tools/${toolId}/execute`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        data: { params },
        timeout: 30000,
      });

      if (res.statusCode === 200 && res.data?.code === 0) {
        const r = res.data.data?.result;
        if (r?.type === 'wave-data') {
          setResult(r as WaveResult);
        } else {
          setResult({ type: 'raw', data: r, metadata: {}, waveType: '' } as any);
        }
      } else {
        Taro.showToast({ title: '执行失败', icon: 'none' });
      }
    } catch { Taro.showToast({ title: '网络错误', icon: 'none' }); }
    finally { setSubmitting(false); }
  };

  // ========== 波形渲染 ==========
  const renderWaveChart = (wave: WaveResult) => {
    const { data, metadata, renderHint } = wave;
    if (!data || data.length === 0) return null;

    // 在 Canvas 不可用时回退到文本展示
    return (
      <View className='wave-result'>
        <View className='wave-meta'>
          {Object.entries(metadata).map(([k, v]) => (
            <View key={k} className='wm-item'>
              <Text className='wm-label'>{k}</Text>
              <Text className='wm-value'>{String(v)}</Text>
            </View>
          ))}
        </View>

        {/* 波形文本示意图 */}
        <View className='wave-chart-text'>
          {generateAsciiWave(data)}
        </View>

        {/* 数据摘要 */}
        <View className='wave-summary'>
          <Text className='ws-title'>数据摘要</Text>
          <Text className='ws-text'>
            采样点: {data.length} | 
            范围: x=[{data[0]?.x?.toFixed(1) ?? 0}, {data[data.length-1]?.x?.toFixed(1) ?? 0}] | 
            y=[{Math.min(...data.map(d=>d.y)).toFixed(2)}, {Math.max(...data.map(d=>d.y)).toFixed(2)}]
          </Text>
        </View>
      </View>
    );
  };

  const generateAsciiWave = (data: { x: number; y: number }[]) => {
    const height = 9;
    const width = 40;
    const yValues = data.map(d => d.y);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const yRange = yMax - yMin || 1;
    const step = Math.max(1, Math.floor(data.length / width));

    const lines: string[] = [];
    for (let row = 0; row < height; row++) {
      const threshold = yMax - (row / (height - 1)) * yRange;
      let line = '';
      for (let i = 0; i < width; i++) {
        const idx = i * step;
        if (idx < data.length && data[idx].y >= threshold) {
          line += '█';
        } else {
          line += ' ';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  };

  if (loading) {
    return (<View className='dp'><View className='ld'><Text>加载工具参数...</Text></View></View>);
  }
  if (!schema) {
    return (<View className='dp'><View className='em'><Text className='ei'>⚠️</Text><Text>无法加载工具参数</Text></View></View>);
  }

  return (
    <ScrollView className='dp' scrollY>
      <View className='th'>
        <Text className='tt'>{toolName}</Text>
        {schema.description && <Text className='td'>{schema.description}</Text>}
        <Text className='tm'>{schema.miniprogramMode === 'readonly' ? '🔍 只读模式' : '📝 完整模式'}</Text>
      </View>

      {schema.parameters?.properties && (
        <View className='ps'>
          <Text className='st'>参数配置</Text>
          {Object.entries(schema.parameters.properties).map(([key, field]) => (
            <View key={key} className='pg'>
              <View className='pl'><Text>{field.title || key}</Text></View>
              {renderControl(key, field)}
            </View>
          ))}
          <Button className='sb' type='primary' loading={submitting} onClick={handleSubmit}>运行</Button>
        </View>
      )}

      {/* 结果渲染 */}
      {result && (
        <View className='rs'>
          <Text className='st'>结果</Text>
          {result.type === 'wave-data' ? renderWaveChart(result) : (
            <View className='rd'><Text>{JSON.stringify(result, null, 2)}</Text></View>
          )}
        </View>
      )}
    </ScrollView>
  );
};

export default DetailPage;
