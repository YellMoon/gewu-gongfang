import { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { unrecognizedExperienceApi } from '../../utils/unrecognizedExperience';
import './index.scss';

export default function UnrecognizedStatusPage() {
  const [status, setStatus] = useState<{
    hasApplication: boolean;
    status?: string;
    type?: string;
    createdAt?: string;
    reviewedAt?: string;
    reviewNote?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await unrecognizedExperienceApi.getApplicationStatus();
      setStatus(data);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '加载失败', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View className="status-page">
        <View className="loading">加载中...</View>
      </View>
    );
  }

  if (!status?.hasApplication) {
    return (
      <View className="status-page">
        <View className="empty">
          <Text className="empty-text">暂无申请记录</Text>
          <Button 
            className="apply-btn"
            onClick={() => Taro.navigateTo({ url: '/pages/unrecognized-apply/index' })}
          >
            立即申请
          </Button>
        </View>
      </View>
    );
  }

  const getStatusInfo = () => {
    switch (status.status) {
      case 'pending':
        return {
          text: '审核中',
          color: '#faad14',
          icon: '⏳',
          description: '您的申请正在审核中，请耐心等待',
        };
      case 'approved':
        return {
          text: '已通过',
          color: '#52c41a',
          icon: 'OK',
          description: '恭喜！您的申请已通过，请重新登录使用正式账号',
        };
      case 'rejected':
        return {
          text: '已拒绝',
          color: '#ff4d4f',
          icon: 'X',
          description: status.reviewNote || '您的申请未通过审核',
        };
      default:
        return {
          text: '未知状态',
          color: '#999',
          icon: '?',
          description: '请稍后重试',
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <View className="status-page">
      <View className="status-card">
        <View className="status-icon">{statusInfo.icon}</View>
        <View className="status-text" style={{ color: statusInfo.color }}>
          {statusInfo.text}
        </View>
        <View className="status-description">{statusInfo.description}</View>
      </View>

      <View className="info-card">
        <View className="info-item">
          <Text className="info-label">申请类型</Text>
          <Text className="info-value">{status.type === 'student' ? '学生' : '老师'}</Text>
        </View>
        <View className="info-item">
          <Text className="info-label">申请时间</Text>
          <Text className="info-value">
            {status.createdAt ? new Date(status.createdAt).toLocaleString() : '-'}
          </Text>
        </View>
        {status.reviewedAt && (
          <View className="info-item">
            <Text className="info-label">审核时间</Text>
            <Text className="info-value">
              {new Date(status.reviewedAt).toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {status.status === 'approved' && (
        <Button 
          className="relogin-btn"
          onClick={() => Taro.reLaunch({ url: '/pages/login/index' })}
        >
          重新登录
        </Button>
      )}

      <Button 
        className="back-btn"
        onClick={() => Taro.navigateBack()}
      >
        返回
      </Button>
    </View>
  );
}
