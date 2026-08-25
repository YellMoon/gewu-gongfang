import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { onNetworkStatusChange, offNetworkStatusChange } from '@tarojs/taro'
import { authSessionRuntime } from '../../utils/authSession'
import { clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime'
import { accountSessionCleanupStorageKeys, isVisitorIdentity } from '../../utils/accountExperience'
import { isOnline, getLastSyncTimestamp, clearBusinessCache } from '../../utils/storage'
import { clearPermissionCache } from '../../utils/permission'
import { pullFromCloud } from '../../utils/sync'
import { miniappCloudBusinessApi } from '../../utils/api'
import AccountStatusBanner from '../../components/AccountStatusBanner'
import MembershipBadge from '../../components/MembershipBadge'
import './index.scss'

declare const __APP_VERSION__: string | undefined

const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
  ? __APP_VERSION__.trim()
  : '8.5.0'

export default function Settings() {
  const currentIdentity = Taro.getStorageSync('user_info')
  const isVisitor = isVisitorIdentity(currentIdentity)
  const isLimitedIdentity = isVisitor
  const [online, setOnline] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState(0)
  const [roleApplications, setRoleApplications] = useState<any[]>([])
  const [profileIds, setProfileIds] = useState<Record<string, string>>({})
  const [reviewingApplicationId, setReviewingApplicationId] = useState('')
  const canReviewRoleApplications = currentIdentity?.user_type === 'super_admin'

  useEffect(() => {
    refreshStatus()
    void loadRoleApplications()
    const handleNetworkStatusChange = (res: { isConnected: boolean }) => {
      setOnline(res.isConnected)
      refreshStatus()
    }
    onNetworkStatusChange(handleNetworkStatusChange)
    return () => offNetworkStatusChange(handleNetworkStatusChange)
  }, [])

  const refreshStatus = () => {
    setOnline(isOnline())
    setLastSync(getLastSyncTimestamp())
  }

  const loadRoleApplications = async () => {
    if (!canReviewRoleApplications) return
    const token = String(Taro.getStorageSync('auth_token') || '').trim()
    const response: any = await miniappCloudBusinessApi.listSubmittedRoleApplications(token)
    if (response.success) setRoleApplications(response.data?.applications || [])
  }

  const reviewRoleApplication = async (application: any, decision: 'approved' | 'rejected') => {
    const profileId = decision === 'approved' ? String(profileIds[application.applicationId] || '').trim() : null
    if (decision === 'approved' && !profileId) {
      Taro.showToast({ title: '\u8bf7\u586b\u5199\u5df2\u6709\u6863\u6848\u7f16\u53f7', icon: 'none' })
      return
    }
    setReviewingApplicationId(application.applicationId)
    try {
      const token = String(Taro.getStorageSync('auth_token') || '').trim()
      const response: any = await miniappCloudBusinessApi.reviewRoleApplication(token, application.applicationId, decision, profileId)
      if (!response.success) throw new Error(response.error || 'review failed')
      await loadRoleApplications()
      Taro.showToast({ title: decision === 'approved' ? '\u5df2\u5173\u8054\u8eab\u4efd' : '\u5df2\u9a73\u56de\u7533\u8bf7', icon: 'success' })
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '\u5904\u7406\u5931\u8d25', icon: 'none' })
    } finally {
      setReviewingApplicationId('')
    }
  }

  const handleRefresh = async () => {
    if (isLimitedIdentity) {
      Taro.showToast({ title: '\u5173\u8054\u8eab\u4efd\u540e\u53ef\u8bfb\u53d6\u4e91\u7aef\u6570\u636e', icon: 'none' })
      return
    }
    if (!online) {
      Taro.showToast({ title: '\u5f53\u524d\u79bb\u7ebf', icon: 'none' })
      return
    }
    setRefreshing(true)
    try {
      const success = await pullFromCloud()
      Taro.showToast({
        title: success ? '\u6570\u636e\u5df2\u5237\u65b0' : '\u6682\u65f6\u65e0\u6cd5\u5237\u65b0\u6570\u636e',
        icon: success ? 'success' : 'none',
      })
      refreshStatus()
    } catch (_error) {
      Taro.showToast({ title: '\u6682\u65f6\u65e0\u6cd5\u5237\u65b0\u6570\u636e', icon: 'none' })
    } finally {
      setRefreshing(false)
    }
  }

  const formatTime = (ts: number) => {
    if (!ts) return '\u4ece\u672a\u66f4\u65b0'
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const handleLogout = () => {
    Taro.showModal({
      title: '\u786e\u8ba4\u9000\u51fa',
      content: '\u786e\u5b9a\u8981\u9000\u51fa\u767b\u5f55\u5417\uff1f',
      success: (res) => {
        if (!res.confirm) return
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
        <AccountStatusBanner />
        <View className='section'>
          <View className='setting-item'>
            <View className='item-left'><View className='item-icon info'>{'\u7528'}</View><Text className='item-label'>{'\u5f53\u524d\u8d26\u53f7'}</Text></View>
            <View className='item-right'><Text className='value'>{currentIdentity?.name || '\u5fae\u4fe1\u7528\u6237'}</Text></View>
          </View>
        </View>
        <View className='section'>
          <View className='setting-item' onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}>
            <View className='item-left'><View className='item-icon info'>{'\u7533'}</View><Text className='item-label'>{'\u7533\u8bf7\u6559\u5e08\u6216\u5b66\u751f\u8eab\u4efd'}</Text></View>
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
            <Text className='value'>{currentIdentity?.name || '\u672a\u77e5\u7528\u6237'}</Text>
            {currentIdentity?.isMember && <View className='member-badge'><Text className='member-text'>{'\u4f1a\u5458'}</Text></View>}
          </View>
        </View>
      </View>

      {canReviewRoleApplications ? <View className='section'>
        <View className='section-title'>{'\u8eab\u4efd\u7533\u8bf7\u5904\u7406'}</View>
        {roleApplications.length === 0 ? <Text className='value'>{'\u6682\u65e0\u5f85\u5904\u7406\u7533\u8bf7'}</Text> : roleApplications.map(application => (
          <View className='setting-item' key={application.applicationId}>
            <View className='item-left'>
              <View className='item-icon info'>{'\u8eab'}</View>
              <View>
                <Text className='item-label'>{application.requestedIdentity}</Text>
                <Text className='value'>{application.bindingHint || '\u65b0\u5efa\u6863\u6848\u7533\u8bf7'}</Text>
                <Input value={profileIds[application.applicationId] || ''} onInput={event => setProfileIds(current => ({ ...current, [application.applicationId]: event.detail.value }))} placeholder={'\u5173\u8054\u5df2\u6709\u6559\u5e08\u6216\u5b66\u751f\u6863\u6848\u7f16\u53f7'} />
              </View>
            </View>
            <View className='item-right'>
              <Text className='arrow' onClick={() => void reviewRoleApplication(application, 'approved')}>{reviewingApplicationId === application.applicationId ? '\u5904\u7406\u4e2d' : '\u901a\u8fc7'}</Text>
              <Text className='arrow' onClick={() => void reviewRoleApplication(application, 'rejected')}>{'\u9a73\u56de'}</Text>
            </View>
          </View>
        ))}
      </View> : null}

      <View className={`sync-status ${online ? 'online' : 'offline'}`}>
        <Text>{online ? '\u5728\u7ebf' : '\u79bb\u7ebf'}</Text>
      </View>

      <View className='section'>
        <View className='section-title'>{'\u4e91\u7aef\u6570\u636e'}</View>
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
