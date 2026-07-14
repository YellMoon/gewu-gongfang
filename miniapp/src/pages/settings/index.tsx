import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { onNetworkStatusChange, offNetworkStatusChange } from '@tarojs/taro'
import { getApiBaseUrl, setApiBaseUrl } from '../../utils/api'
import { authSessionRuntime } from '../../utils/authSession'
import { clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime'
import { reviewCleanupStorageKeys } from '../../utils/reviewExperience'
import { isReviewExperienceIdentity } from '../../utils/reviewExperience'
import { isOnline, getPendingChanges, clearPendingChanges, getLastSyncTimestamp, clearBusinessCache } from '../../utils/storage'
import { clearPermissionCache } from '../../utils/permission'
import { triggerSync, pullFromCloud } from '../../utils/sync'
import ReviewDemoBanner from '../../components/ReviewDemoBanner'
import './index.scss'

export default function Settings() {
  const currentIdentity = Taro.getStorageSync('user_info')
  const isReviewDemo = isReviewExperienceIdentity(currentIdentity)
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl())
  const [lastSync, setLastSync] = useState(0)
  const [editingUrl, setEditingUrl] = useState(false)
  const [tempUrl, setTempUrl] = useState('')

  useEffect(() => {
    refreshStatus()
    const unsub = onNetworkStatusChange((res) => {
      setOnline(res.isConnected)
      refreshStatus()
    })
    return () => offNetworkStatusChange()
  }, [])

  const refreshStatus = () => {
    setOnline(isOnline())
    if (isReviewDemo) {
      setPendingCount(0)
      setLastSync(0)
      return
    }
    const pending = getPendingChanges()
    setPendingCount(pending.length)
    setLastSync(getLastSyncTimestamp())
  }

  const handleSyncNow = async () => {
    if (isReviewDemo) {
      Taro.showToast({ title: '\u5ba1\u6838\u4f53\u9a8c\u4e2d\u4e0d\u53ef\u540c\u6b65\u4e1a\u52a1\u6570\u636e', icon: 'none' })
      return
    }
    if (!online) {
      Taro.showToast({ title: '当前离线', icon: 'none' })
      return
    }
    setSyncing(true)
    try {
      await pullFromCloud()
      const result = await triggerSync()
      if (result.success) {
        Taro.showToast({ title: '同步完成', icon: 'success' })
      } else {
        Taro.showToast({ title: result.message || '同步失败', icon: 'none' })
      }
      refreshStatus()
    } catch (e) {
      Taro.showToast({ title: '同步异常', icon: 'none' })
    } finally {
      setSyncing(false)
    }
  }

  const handleEditUrl = () => {
    if (isReviewDemo) return
    setTempUrl(serverUrl)
    setEditingUrl(true)
  }

  const handleSaveUrl = () => {
    if (isReviewDemo) {
      setEditingUrl(false)
      return
    }
    if (tempUrl.trim()) {
      setApiBaseUrl(tempUrl.trim())
      setServerUrl(tempUrl.trim())
      Taro.showToast({ title: '已保存', icon: 'success' })
    }
    setEditingUrl(false)
  }

  const handleClearPending = () => {
    if (isReviewDemo) return
    Taro.showModal({
      title: '确认清空',
      content: `确定要清空 ${pendingCount} 条待同步数据？`,
      success: (res) => {
        if (res.confirm) {
          clearPendingChanges()
          refreshStatus()
          Taro.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  }

  const formatTime = (ts: number) => {
    if (!ts) return '从未同步'
    const d = new Date(ts)
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  const handleLogout = () => {
    Taro.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          const currentUser = Taro.getStorageSync('user_info')
          const exitingReview = isReviewExperienceIdentity(currentUser)
          clearAuthenticatedSession({
            invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
            clearPermissionCache,
            clearBusinessCache,
            removeStorage: (key: string) => Taro.removeStorageSync(key),
            cleanupStorageKeys: reviewCleanupStorageKeys,
          }, [currentUser])
          if (exitingReview) Taro.reLaunch({ url: '/pages/login/index' })
          else Taro.redirectTo({ url: '/pages/login/index' })
        }
      }
    })
  }

  const pendingChanges = isReviewDemo ? [] : getPendingChanges().slice(0, 10)

  return (
    <View className='settings-page'>
      <ReviewDemoBanner />
      {isReviewDemo ? <View className='section'><Text className='item-label'>{'\u5ba1\u6838\u4f53\u9a8c\u671f\u95f4\u4e1a\u52a1\u6570\u636e\u53ea\u8bfb\uff0c\u4e0d\u53ef\u4fee\u6539\u670d\u52a1\u5668\u3001\u540c\u6b65\u6216\u6e05\u7a7a\u5f85\u540c\u6b65\u6570\u636e\u3002'}</Text></View> : null}
      {/* 网络状态 */}
      <View className={`sync-status ${online ? 'online' : 'offline'}`}>
        <Text>{online ? '在线' : '离线'}</Text>
        {pendingCount > 0 && <Text> · {pendingCount}条待同步</Text>}
      </View>

      {/* 服务器设置 */}
      <View className='section'>
        <View className='section-title'>服务器配置</View>
        <View className='setting-item' onClick={isReviewDemo ? undefined : handleEditUrl}>
          <View className='item-left'>
            <View className='item-icon server'>云</View>
            <Text className='item-label'>API 服务器地址</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>{serverUrl}</Text>
            <Text className='arrow'>›</Text>
          </View>
        </View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon sync'>同</View>
            <Text className='item-label'>上次同步</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>{formatTime(lastSync)}</Text>
          </View>
        </View>
      </View>

      {/* 同步操作 */}
      <View className='section'>
        <View className='section-title'>数据同步</View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon queue'>列</View>
            <Text className='item-label'>待同步数据</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>{pendingCount} 条</Text>
          </View>
        </View>

        {pendingCount > 0 && (
          <View className='pending-list'>
            {pendingChanges.map((item, idx) => (
              <View key={item.id || idx} className='pending-item'>
                <Text className={`action-tag ${item.action}`}>{item.action === 'create' ? '新增' : item.action === 'update' ? '修改' : '删除'}</Text>
                <Text className='table-tag'>{item.table}</Text>
                <Text className='time'>{formatTime(item.timestamp)}</Text>
              </View>
            ))}
          </View>
        )}

        <View className='sync-button-wrap'>
          <button className='btn-sync' onClick={handleSyncNow} disabled={isReviewDemo || syncing || !online}>
            {syncing ? '同步中...' : '立即同步'}
          </button>
        </View>

        {pendingCount > 0 && (
          <View className='setting-item' onClick={isReviewDemo ? undefined : handleClearPending}>
            <View className='item-left'>
              <View className='item-icon danger'>清</View>
              <Text className='item-label danger-text'>清空待同步</Text>
            </View>
          </View>
        )}
      </View>

      {/* 关于 */}
      <View className='section'>
        <View className='section-title'>关于</View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon info'>版</View>
            <Text className='item-label'>版本号</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>3.1.0-0504</Text>
          </View>
        </View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon info'>开</View>
            <Text className='item-label'>开发者</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>小龙虾</Text>
          </View>
        </View>
      </View>

      {/* 版本信息 */}
      <View className='version-info'>
        <Text className='app-name'>格物工坊教务管理系统</Text>
        <Text>云平台版 v3.1.0</Text>
      </View>

      {/* 退出登录 */}
      <View className='logout-wrap'>
        {isReviewDemo ? <Text className='item-label'>{'\u9000\u51fa\u5ba1\u6838\u4f53\u9a8c'}</Text> : null}
        <button
          className='logout-btn'
          onClick={handleLogout}
        >
          退出登录
        </button>
      </View>
    </View>
  )
}
