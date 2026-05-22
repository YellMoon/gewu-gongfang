import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { onNetworkStatusChange, offNetworkStatusChange } from '@tarojs/taro'
import { getApiBaseUrl, setApiBaseUrl } from '../../utils/api'
import { isOnline, getPendingChanges, clearPendingChanges, getLastSyncTimestamp } from '../../utils/storage'
import { clearPermissionCache } from '../../utils/permission'
import { triggerSync, pullFromCloud } from '../../utils/sync'
import './index.scss'

export default function Settings() {
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
    const pending = getPendingChanges()
    setPendingCount(pending.length)
    setLastSync(getLastSyncTimestamp())
  }

  const handleSyncNow = async () => {
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
    setTempUrl(serverUrl)
    setEditingUrl(true)
  }

  const handleSaveUrl = () => {
    if (tempUrl.trim()) {
      setApiBaseUrl(tempUrl.trim())
      setServerUrl(tempUrl.trim())
      Taro.showToast({ title: '已保存', icon: 'success' })
    }
    setEditingUrl(false)
  }

  const handleClearPending = () => {
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
          clearPermissionCache()
          Taro.removeStorageSync('auth_token')
          Taro.removeStorageSync('user_info')
          Taro.redirectTo({ url: '/pages/login/index' })
        }
      }
    })
  }

  const pendingChanges = getPendingChanges().slice(0, 10)

  return (
    <View className='settings-page'>
      {/* 网络状态 */}
      <View className={`sync-status ${online ? 'online' : 'offline'}`}>
        <Text>{online ? '📶 在线' : '📴 离线'}</Text>
        {pendingCount > 0 && <Text> · {pendingCount}条待同步</Text>}
      </View>

      {/* 服务器设置 */}
      <View className='section'>
        <View className='section-title'>服务器配置</View>
        <View className='setting-item' onClick={handleEditUrl}>
          <View className='item-left'>
            <View className='item-icon' style={{background:'#e6f7ff'}}>☁️</View>
            <Text className='item-label'>API 服务器地址</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>{serverUrl}</Text>
            <Text className='arrow'>›</Text>
          </View>
        </View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon' style={{background:'#f6ffed'}}>🔄</View>
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
            <View className='item-icon' style={{background:'#fff7e6'}}>📋</View>
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

        <View style={{ padding: '16rpx 32rpx' }}>
          <button className='btn-sync' onClick={handleSyncNow} disabled={syncing || !online}>
            {syncing ? '同步中...' : '立即同步'}
          </button>
        </View>

        {pendingCount > 0 && (
          <View className='setting-item' onClick={handleClearPending}>
            <View className='item-left'>
              <View className='item-icon' style={{background:'#fff2f0'}}>🗑️</View>
              <Text className='item-label' style={{color:'#ff4d4f'}}>清空待同步</Text>
            </View>
          </View>
        )}
      </View>

      {/* 关于 */}
      <View className='section'>
        <View className='section-title'>关于</View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon' style={{background:'#f9f0ff'}}>ℹ️</View>
            <Text className='item-label'>版本号</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>3.1.0-0504</Text>
          </View>
        </View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon' style={{background:'#f9f0ff'}}>👨‍💻</View>
            <Text className='item-label'>开发者</Text>
          </View>
          <View className='item-right'>
            <Text className='value'>小龙虾</Text>
          </View>
        </View>
      </View>

      {/* 版本信息 */}
      <View className='version-info'>
        <Text className='app-name'>📚 教务管理系统</Text>
        <Text>云平台版 v3.1.0</Text>
      </View>

      {/* 退出登录 */}
      <View style={{ padding: '40rpx 30rpx' }}>
        <button
          style={{ width: '100%', height: '88rpx', lineHeight: '88rpx', background: '#ff4d4f', color: '#fff', borderRadius: '44rpx', fontSize: '30rpx', border: 'none' }}
          onClick={handleLogout}
        >
          退出登录
        </button>
      </View>
    </View>
  )
}
