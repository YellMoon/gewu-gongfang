import { useState, useEffect, useRef } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { onNetworkStatusChange, offNetworkStatusChange } from '@tarojs/taro'
import { authSessionRuntime } from '../../utils/authSession'
import { clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime'
import { accountSessionCleanupStorageKeys, isFormalIdentity, isVisitorIdentity } from '../../utils/accountExperience'
import { getLastSyncTimestamp, clearBusinessCache } from '../../utils/storage'
import { clearPermissionCache } from '../../utils/permission'
import { pullFromCloud } from '../../utils/sync'
import MembershipBadge from '../../components/MembershipBadge'
import miniappPackage from '../../../package.json'
import './index.scss'

declare const __APP_VERSION__: string | undefined

const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
  ? __APP_VERSION__.trim()
  : miniappPackage.version

export default function Settings() {
  const [currentIdentity, setCurrentIdentity] = useState(() => Taro.getStorageSync('user_info'))
  const isLimitedIdentity = !isFormalIdentity(currentIdentity)
  const [online, setOnline] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState(getLastSyncTimestamp)
  const requestSequence = useRef(0)
  const refreshInFlight = useRef(false)
  const visible = useRef(true)
  const networkSequence = useRef(0)

  const refreshStatus = () => {
    setLastSync(getLastSyncTimestamp())
    setCurrentIdentity(Taro.getStorageSync('user_info'))
  }

  useDidShow(() => {
    visible.current = true
    requestSequence.current++
    refreshInFlight.current = false
    setRefreshing(false)
    refreshStatus()
    const sequence = ++networkSequence.current
    void Taro.getNetworkType().then(result => {
      if (visible.current && sequence === networkSequence.current) setOnline(result.networkType !== 'none')
    }).catch(() => { /* A failed network check does not prove offline; manual refresh can retry. */ })
  })
  useDidHide(() => {
    visible.current = false
    requestSequence.current++
    networkSequence.current++
    refreshInFlight.current = false
  })

  useEffect(() => {
    const handleNetworkStatusChange = (res: { isConnected: boolean }) => {
      networkSequence.current++
      if (visible.current) {
        setOnline(res.isConnected)
        refreshStatus()
      }
    }
    onNetworkStatusChange(handleNetworkStatusChange)
    return () => {
      visible.current = false
      requestSequence.current++
      networkSequence.current++
      refreshInFlight.current = false
      offNetworkStatusChange(handleNetworkStatusChange)
    }
  }, [])

  const handleRefresh = async () => {
    if (!visible.current || refreshInFlight.current) return
    if (!isFormalIdentity(Taro.getStorageSync('user_info'))) {
      Taro.showToast({ title: '\u5173\u8054\u8eab\u4efd\u540e\u53ef\u8bfb\u53d6\u4e91\u7aef\u6570\u636e', icon: 'none' })
      return
    }
    if (!online) {
      Taro.showToast({ title: '\u5f53\u524d\u79bb\u7ebf', icon: 'none' })
      return
    }
    const session = authSessionRuntime.capture()
    const sequence = ++requestSequence.current
    const isCurrent = () => visible.current && sequence === requestSequence.current && authSessionRuntime.isSameSession(session)
    refreshInFlight.current = true
    setRefreshing(true)
    try {
      const success = await pullFromCloud()
      if (!isCurrent()) return
      Taro.showToast({
        title: success ? '\u6570\u636e\u5df2\u5237\u65b0' : '\u6682\u65f6\u65e0\u6cd5\u5237\u65b0\u6570\u636e',
        icon: success ? 'success' : 'none',
      })
      refreshStatus()
    } catch (_error) {
      if (!isCurrent()) return
      Taro.showToast({ title: '\u6682\u65f6\u65e0\u6cd5\u5237\u65b0\u6570\u636e', icon: 'none' })
    } finally {
      if (sequence === requestSequence.current) {
        refreshInFlight.current = false
        if (visible.current) setRefreshing(false)
      }
    }
  }

  const formatTime = (ts: number) => {
    if (!ts) return '\u4ece\u672a\u66f4\u65b0'
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const handleLogout = () => {
    const session = authSessionRuntime.capture()
    Taro.showModal({
      title: '\u786e\u8ba4\u9000\u51fa',
      content: '\u786e\u5b9a\u8981\u9000\u51fa\u767b\u5f55\u5417\uff1f',
      success: (res) => {
        if (!res.confirm || !visible.current || !authSessionRuntime.isSameSession(session, { allowInvalidated: true })) return
        const currentUser = Taro.getStorageSync('user_info')
        const exitingExperience = isVisitorIdentity(currentUser)
        clearAuthenticatedSession({
          invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
          clearPermissionCache,
          clearBusinessCache,
          removeStorage: (key: string) => Taro.removeStorageSync(key),
          cleanupStorageKeys: accountSessionCleanupStorageKeys,
        }, [currentUser])
        if (exitingExperience) Taro.reLaunch({ url: '/pages/login/index' })
        else Taro.redirectTo({ url: '/pages/login/index' })
      },
    })
  }

  if (isLimitedIdentity) {
    return (
      <View className='settings-page'>
        <View className='section'>
          <View className='setting-item'>
            <View className='item-left'><View className='item-icon info'>{'\u7528'}</View><Text className='item-label'>{'\u5f53\u524d\u8d26\u53f7'}</Text></View>
            <View className='item-right'><Text className='value'>{currentIdentity?.name || '\u5fae\u4fe1\u7528\u6237'}</Text></View>
          </View>
        </View>
        <View className='section'>
          <View className='setting-item role-application-entry' onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}>
            <View className='item-left'><View className='item-icon info'>{'\u7533'}</View><Text className='item-label'>{'\u7533\u8bf7\u89d2\u8272'}</Text></View>
            <View className='item-right'><Text className='arrow'>{'\u203a'}</Text></View>
          </View>
        </View>
        <View className='logout-wrap'><button className='logout-btn' onClick={handleLogout}>{'\u9000\u51fa\u767b\u5f55'}</button></View>
      </View>
    )
  }

  return (
    <View className='settings-page'>
      <View className='section'>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon info'>{'\u7528'}</View>
            <Text className='item-label'>{'\u5f53\u524d\u7528\u6237'}</Text>
          </View>
          <View className='item-right'>
            <MembershipBadge membership={currentIdentity?.membership} />
            <Text className='value'>{currentIdentity?.name || '\u5fae\u4fe1\u7528\u6237'}</Text>
            {currentIdentity?.isMember && <View className='member-badge'><Text className='member-text'>{'\u4f1a\u5458'}</Text></View>}
          </View>
        </View>
      </View>

      {!online && <View className='sync-status offline'>
        <Text>{'\u5f53\u524d\u79bb\u7ebf'}</Text>
      </View>}

      <View className='section'>
        <View className='section-title'>{'\u6570\u636e\u66f4\u65b0'}</View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon sync'>{'\u540c'}</View>
            <Text className='item-label'>{'\u4e0a\u6b21\u66f4\u65b0'}</Text>
          </View>
          <View className='item-right'><Text className='value'>{formatTime(lastSync)}</Text></View>
        </View>
        <View className='sync-button-wrap'>
          <button className='btn-sync' onClick={handleRefresh} disabled={refreshing || !online}>
            {refreshing ? '\u5237\u65b0\u4e2d...' : '\u5237\u65b0\u6570\u636e'}
          </button>
        </View>
      </View>

      <View className='section'>
        <View className='section-title'>{'\u5173\u4e8e'}</View>
        <View className='setting-item'>
          <View className='item-left'>
            <View className='item-icon info'>{'\u7248'}</View>
            <Text className='item-label'>{'\u7248\u672c\u53f7'}</Text>
          </View>
          <View className='item-right'><Text className='value'>{APP_VERSION}</Text></View>
        </View>
      </View>

      <View className='version-info'>
        <Text className='app-name'>{'\u683c\u7269\u5de5\u574a'}</Text>
        <Text>{'\u6559\u52a1\u7ba1\u7406'}</Text>
      </View>

      <View className='logout-wrap'>
        <button className='logout-btn' onClick={handleLogout}>{'\u9000\u51fa\u767b\u5f55'}</button>
      </View>
    </View>
  )
}
