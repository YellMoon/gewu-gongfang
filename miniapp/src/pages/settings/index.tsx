import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { onNetworkStatusChange, offNetworkStatusChange } from '@tarojs/taro'
import { getApiBaseUrl, setApiBaseUrl } from '../../utils/api'
import { authSessionRuntime } from '../../utils/authSession'
import { clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime'
import { accountSessionCleanupStorageKeys, isUnrecognizedIdentity } from '../../utils/accountExperience'
import { isOnline, getPendingChanges, clearPendingChanges, getLastSyncTimestamp, clearBusinessCache } from '../../utils/storage'
import { clearPermissionCache } from '../../utils/permission'
import { triggerSync, pullFromCloud } from '../../utils/sync'
import AccountStatusBanner from '../../components/AccountStatusBanner'
import MembershipBadge from '../../components/MembershipBadge'
import './index.scss'

export default function Settings() {
  const currentIdentity = Taro.getStorageSync('user_info')
  const isUnrecognized = isUnrecognizedIdentity(currentIdentity)
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl())
  const [lastSync, setLastSync] = useState(0)
  const [editingUrl, setEditingUrl] = useState(false)
  const [tempUrl, setTempUrl] = useState('')

  useEffect(() => {
    refreshStatus()
    const handleNetworkStatusChange = (res: { isConnected: boolean }) => {
      setOnline(res.isConnected)
      refreshStatus()
    }
    onNetworkStatusChange(handleNetworkStatusChange)
    return () => offNetworkStatusChange(handleNetworkStatusChange)
  }, [])

  const refreshStatus = () => {
    setOnline(isOnline())
    if (isUnrecognized) {
      setPendingCount(0)
      setLastSync(0)
      return
    }
    const pending = getPendingChanges()
    setPendingCount(pending.length)
    setLastSync(getLastSyncTimestamp())
  }

  const handleSyncNow = async () => {
    if (isUnrecognized) {
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
    if (isUnrecognized) return
    setTempUrl(serverUrl)
    setEditingUrl(true)
  }

  const handleSaveUrl = () => {
    if (isUnrecognized) {
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
    if (isUnrecognized) return
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
          const exitingExperience = isUnrecognizedIdentity(currentUser)
          clearAuthenticatedSession({
            invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
            clearPermissionCache,
            clearBusinessCache,
            removeStorage: (key: string) => Taro.removeStorageSync(key),
            cleanupStorageKeys: accountSessionCleanupStorageKeys,
          }, [currentUser])
          if (exitingExperience) Taro.reLaunch({ url: '/pages/login/index' })
          else Taro.redirectTo({ url: '/pages/login/index' })
        }
      }
    })
  }

  if (isUnrecognized) {
    return (
      <View className='settings-page'>
        <AccountStatusBanner />
        <View className='section'>
          <View className='setting-item'>
            <View className='item-left'><View className='item-icon info'>{'\u7528'}</View><Text className='item-label'>{'\u5f53\u524d\u8d26\u53f7'}</Text></View>
            <View className='item-right'><Text className='value'>{currentIdentity?.name || '\u5fae\u4fe1\u7528\u6237'}</Text></View>
          </View>
        </View>
        <View className='section'>
          <View className='setting-item' onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}>
            <View className='item-left'><View className='item-icon info'>{'\u7533'}</View><Text className='item-label'>{'\u7533\u8bf7\u6b63\u5f0f\u8d26\u53f7'}</Text></View>
            <View className='item-right'><Text className='arrow'>{'\u203a'}</Text></View>
          </View>
        </View>
        <View className='logout-wrap'><button className='logout-btn' onClick={handleLogout}>{'\u9000\u51fa\u767b\u5f55'}</button></View>
      </View>
    )
  }

  const pendingChanges = getPendingChanges().slice(0, 10)

  return (
    <View className='settings-page'>
      
      {/* 用户信息 */}
      <View className='section'>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon info'>用</View>
            <Text className='item-label'>当前用户</Text>
          </View>
          <View className='item-right'>
            <MembershipBadge membership={currentIdentity?.membership} />
            <Text className='value'>{currentIdentity?.name || '未知用户'}</Text>
            {currentIdentity?.isMember && (
              <View className='member-badge'>
                <Text className='member-text'>会员</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 网络状态 */}
      <View className={`sync-status ${online ? 'online' : 'offline'}`}>
        <Text>{online ? '在线' : '离线'}</Text>
        {pendingCount > 0 && <Text> · {pendingCount}条待同步</Text>}
      </View>

      {/* 服务器设置 */}
      <View className='section'>
        <View className='section-title'>服务器配置</View>
        <View className='setting-item' onClick={handleEditUrl}>
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
          <button className='btn-sync' onClick={handleSyncNow} disabled={syncing || !online}>
            {syncing ? '同步中...' : '立即同步'}
          </button>
        </View>

        {pendingCount > 0 && (
          <View className='setting-item' onClick={handleClearPending}>
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
