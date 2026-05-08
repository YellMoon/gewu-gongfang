// 机械波演示 — 三重独立Canvas实时波形动画（三波形叠加）
import React, { useState } from 'react';
import { Card, Slider, Typography, Row, Col, Tag, Space, Button, Divider, Switch } from 'antd';
import { SoundOutlined, PlayCircleOutlined, PauseOutlined, ReloadOutlined, FastForwardOutlined, FastBackwardOutlined } from '@ant-design/icons';
import type { PluginComponentProps } from '../plugin-api';
import WaveVisualization from './WaveVisualization';

const { Text } = Typography;

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

const WaveDemo: React.FC<PluginComponentProps> = ({ params, onParamsChange }) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [direction, setDirection] = useState<'right' | 'left'>('right');
  const [sourcePos, setSourcePos] = useState<'left' | 'center' | 'right'>('center');

  const dualMedium = params.dualMedium === true;

  const handleChange = (key: string, value: any) => {
    onParamsChange({ ...params, [key]: value });
  };

  const handleReset = () => {
    onParamsChange({
      amplitude1: 2, frequency1: 1, wavelength1: 4,
      amplitude2: 2, frequency2: 1, wavelength2: 4,
      dualMedium: false, v1: 1, v2: 0.5, x1Boundary: 0.5,
      showParticles: false,
    });
    setSpeed(1);
    setDirection('right');
    setSourcePos('center');
    setIsPlaying(true);
  };

  return (
    <div style={{ padding: 16 }}>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SoundOutlined style={{ fontSize: 28, color: '#1890ff' }} />
          <div>
            <h3 style={{ margin: 0 }}>机械波演示</h3>
            <Text type="secondary">三重独立波形 · Canvas 实时渲染</Text>
          </div>
          <Tag color="processing" style={{ marginLeft: 'auto' }}>v3.1.0</Tag>
        </div>
      </Card>

      {/* 控制模块放在波形预览上方 */}
      <Card size="small" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* 播放控制 */}
          <Space>
            <Button size="small" type={isPlaying ? 'primary' : 'default'}
              icon={isPlaying ? <PauseOutlined /> : <PlayCircleOutlined />}
              onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? '暂停' : '播放'}
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
          </Space>

          <Divider type="vertical" />

          {/* 倍速 */}
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>倍速:</Text>
            {SPEED_OPTIONS.map(spd => (
              <Button
                key={spd}
                size="small"
                type={speed === spd ? 'primary' : 'default'}
                onClick={() => setSpeed(spd)}
                style={{ minWidth: 40 }}
              >
                {spd}x
              </Button>
            ))}
          </Space>

          <Divider type="vertical" />

          {/* 传播方向 */}
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>传播方向:</Text>
            <Button size="small" type={direction === 'right' ? 'primary' : 'default'}
              icon={<FastForwardOutlined />} onClick={() => setDirection('right')}>向右</Button>
            <Button size="small" type={direction === 'left' ? 'primary' : 'default'}
              icon={<FastBackwardOutlined />} onClick={() => setDirection('left')}>向左</Button>
          </Space>

          <Divider type="vertical" />

          {/* 波源位置 */}
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>波源:</Text>
            {(['left', 'center', 'right'] as const).map(pos => (
              <Button
                key={pos}
                size="small"
                type={sourcePos === pos ? 'primary' : 'default'}
                onClick={() => setSourcePos(pos)}
              >
                {pos === 'left' ? '左边' : pos === 'center' ? '中间' : '右边'}
              </Button>
            ))}
          </Space>

          <Divider type="vertical" />

          {/* 双介质开关 */}
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>双介质:</Text>
            <Switch checked={dualMedium} onChange={v => handleChange('dualMedium', v)} size="small" />
          </Space>
        </div>

        {/* 双介质参数行 */}
        {dualMedium && (
          <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Space>
              <Text type="secondary" style={{ fontSize: 11 }}>波速 v₁:</Text>
              <Slider min={0.1} max={5} step={0.1} value={params.v1 ?? 1}
                onChange={v => handleChange('v1', v)}
                style={{ width: 120 }} />
              <span style={{ fontSize: 11 }}>{(params.v1 ?? 1).toFixed(1)}</span>
            </Space>
            <Space>
              <Text type="secondary" style={{ fontSize: 11 }}>波速 v₂:</Text>
              <Slider min={0.1} max={5} step={0.1} value={params.v2 ?? 0.5}
                onChange={v => handleChange('v2', v)}
                style={{ width: 120 }} />
              <span style={{ fontSize: 11 }}>{(params.v2 ?? 0.5).toFixed(1)}</span>
            </Space>
            <Space>
              <Text type="secondary" style={{ fontSize: 11 }}>分界位置:</Text>
              <Slider min={0.1} max={0.9} step={0.05} value={params.x1Boundary ?? 0.5}
                onChange={v => handleChange('x1Boundary', v)}
                style={{ width: 120 }} />
              <span style={{ fontSize: 11 }}>{Math.round((params.x1Boundary ?? 0.5) * 100)}%</span>
            </Space>
          </div>
        )}
      </Card>

      {/* 波形参数调整行 */}
      <Card size="small" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11, color: '#e74c3c' }}>波形一</Text>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <Space><Text style={{ fontSize: 11 }}>A:</Text>
                <Slider min={0.1} max={5} step={0.1} value={params.amplitude1 ?? 2}
                  onChange={v => handleChange('amplitude1', v)} style={{ width: 80 }} /></Space>
              <Space><Text style={{ fontSize: 11 }}>f:</Text>
                <Slider min={0.1} max={5} step={0.1} value={params.frequency1 ?? 1}
                  onChange={v => handleChange('frequency1', v)} style={{ width: 80 }} /></Space>
              <Space><Text style={{ fontSize: 11 }}>λ:</Text>
                <Slider min={0.5} max={10} step={0.5} value={params.wavelength1 ?? 4}
                  onChange={v => handleChange('wavelength1', v)} style={{ width: 80 }} /></Space>
            </div>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, color: '#2ecc71' }}>波形二</Text>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <Space><Text style={{ fontSize: 11 }}>A:</Text>
                <Slider min={0.1} max={5} step={0.1} value={params.amplitude2 ?? 2}
                  onChange={v => handleChange('amplitude2', v)} style={{ width: 80 }} /></Space>
              <Space><Text style={{ fontSize: 11 }}>f:</Text>
                <Slider min={0.1} max={5} step={0.1} value={params.frequency2 ?? 1}
                  onChange={v => handleChange('frequency2', v)} style={{ width: 80 }} /></Space>
              <Space><Text style={{ fontSize: 11 }}>λ:</Text>
                <Slider min={0.5} max={10} step={0.5} value={params.wavelength2 ?? 4}
                  onChange={v => handleChange('wavelength2', v)} style={{ width: 80 }} /></Space>
            </div>
          </div>
        </div>
      </Card>

      {/* 波形预览 */}
      <Card size="small" bodyStyle={{ padding: 8 }}>
        {isPlaying ? (
          <WaveVisualization
            amplitude1={params.amplitude1 ?? 2}
            frequency1={params.frequency1 ?? 1}
            wavelength1={params.wavelength1 ?? 4}
            amplitude2={params.amplitude2 ?? 2}
            frequency2={params.frequency2 ?? 1}
            wavelength2={params.wavelength2 ?? 4}
            dualMedium={dualMedium}
            v1={params.v1 ?? 1}
            v2={params.v2 ?? 0.5}
            x1Boundary={params.x1Boundary ?? 0.5}
            showParticles={false}
            width={800}
            speedMultiplier={speed}
            direction={direction}
            sourcePosition={sourcePos}
            renderControls={false}
          />
        ) : (
          <div style={{
            height: 280,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#1a1a2e', borderRadius: 8,
          }}>
            <Space direction="vertical" align="center">
              <PauseOutlined style={{ fontSize: 48, color: '#888' }} />
              <Text type="secondary">点击「播放」开始动画</Text>
            </Space>
          </div>
        )}
      </Card>
    </div>
  );
};

export default WaveDemo;
