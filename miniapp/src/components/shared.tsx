/**
 * 共享 UI 组件 — 微信小程序版
 * LoadingSkeleton / NetworkStatus / EmptyState / PullRefresh wrapper
 */
import { View, Text, ScrollView } from '@tarojs/components';
import { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';
import './shared.scss';

// ========== LoadingSkeleton ==========

interface SkeletonProps {
  rows?: number;
  avatar?: boolean;
}

export function LoadingSkeleton({ rows = 3, avatar = false }: SkeletonProps) {
  return (
    <View className="sk-container">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="sk-row">
          {avatar && <View className="sk-avatar" />}
          <View className="sk-lines">
            <View className="sk-line sk-line-long" />
            <View className="sk-line sk-line-short" />
          </View>
        </View>
      ))}
    </View>
  );
}

// ========== NetworkStatus ==========

interface NetworkStatusProps {
  onRetry?: () => void;
}

export function NetworkStatus({ onRetry }: NetworkStatusProps) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    Taro.getNetworkType({
      success: (res) => setOnline(res.networkType !== 'none'),
    });

    const handler = (res: Taro.onNetworkStatusChange.CallbackResult) => {
      setOnline(res.isConnected);
    };
    Taro.onNetworkStatusChange(handler);
    return () => Taro.offNetworkStatusChange(handler);
  }, []);

  if (online) return null;

  return (
    <View className="ns-bar">
      <Text className="ns-icon">⚠️</Text>
      <Text className="ns-text">当前离线，数据来自本地缓存</Text>
      {onRetry && (
        <View className="ns-retry" onClick={onRetry}>
          <Text className="ns-retry-text">重试</Text>
        </View>
      )}
    </View>
  );
}

// ========== EmptyState ==========

interface EmptyStateProps {
  icon?: string;
  text?: string;
  actionText?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = '📭',
  text = '暂无数据',
  actionText,
  onAction,
}: EmptyStateProps) {
  return (
    <View className="es-container">
      <Text className="es-icon">{icon}</Text>
      <Text className="es-text">{text}</Text>
      {actionText && onAction && (
        <View className="es-action" onClick={onAction}>
          <Text className="es-action-text">{actionText}</Text>
        </View>
      )}
    </View>
  );
}

// ========== StatCard ==========

interface StatCardProps {
  label: string;
  value: string | number;
  suffix?: string;
  color?: string;
  icon?: string;
}

export function StatCard({ label, value, suffix, color = '#1890ff', icon }: StatCardProps) {
  return (
    <View className="st-card" style={{ borderTopColor: color }}>
      <View className="st-header">
        {icon && <Text className="st-icon">{icon}</Text>}
        <Text className="st-label">{label}</Text>
      </View>
      <View className="st-value-row">
        <Text className="st-value" style={{ color }}>{value}</Text>
        {suffix && <Text className="st-suffix">{suffix}</Text>}
      </View>
    </View>
  );
}

// ========== PullRefresh wrapper ==========

interface PullRefreshViewProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

export function PullRefreshView({ onRefresh, children, className }: PullRefreshViewProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      className={`pr-scroll ${className || ''}`}
      scrollY
      refresherEnabled
      refresherTriggered={refreshing}
      onRefresherRefresh={handleRefresh}
      refresherBackground="#f5f5f5"
    >
      {children}
    </ScrollView>
  );
}
