import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { isVisitorIdentity } from '../../utils/accountExperience';
import { applicationApi } from '../../utils/api';
import {
  buildRoleApplicationRequest,
  copyForApplicationState,
  createApplicationOperationLock,
} from './applicationRuntime';
import './index.scss';

type RequestedRole = 'student' | 'teacher';

const ROLE_OPTIONS = [
  { value: 'student' as RequestedRole, label: '\u5b66\u751f' },
  { value: 'teacher' as RequestedRole, label: '\u8001\u5e08' },
];

function idempotencyKey(identityId: string, role: RequestedRole): string {
  const storageKey = `authority_role_application_key:${identityId}:${role}`;
  const existing = String(Taro.getStorageSync(storageKey) || '').trim();
  if (existing) return existing;
  const created = `miniapp-role-${identityId}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  Taro.setStorageSync(storageKey, created);
  return created;
}

function responseData(response: any): any {
  if (!response?.success) throw new Error(response?.error || '\u8bf7\u6c42\u5931\u8d25');
  return response.data || response;
}

export default function AccountApplicationPage() {
  const identity: any = Taro.getStorageSync('user_info') || {};
  const operationLock = useRef(createApplicationOperationLock());
  const [state, setState] = useState('loading');
  const [application, setApplication] = useState<any>(null);
  const [roleIndex, setRoleIndex] = useState(0);
  const [bindingHint, setBindingHint] = useState('');

  const load = async () => {
    if (!operationLock.current.tryAcquire('refresh')) return;
    setState('loading');
    try {
      const result = responseData(await applicationApi.mine());
      const nextApplication = result.application || null;
      setApplication(nextApplication);
      setState(result.state || 'not_submitted');
      if (nextApplication?.requestedRole) {
        setRoleIndex(nextApplication.requestedRole === 'teacher' ? 1 : 0);
      }
      if (nextApplication?.bindingHint) setBindingHint(nextApplication.bindingHint);
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      setState(message.includes('network') || message.includes('\u7f51\u7edc') ? 'offline' : 'network_error');
    } finally {
      operationLock.current.release('refresh');
    }
  };

  useEffect(() => {
    if (!isVisitorIdentity(identity)) {
      Taro.reLaunch({ url: '/pages/login/index' });
      return;
    }
    void load();
  }, []);

  const submit = async () => {
    if (!operationLock.current.tryAcquire('submit')) return;
    setState('submitting');
    const requestedRole = ROLE_OPTIONS[roleIndex].value;
    try {
      const request = buildRoleApplicationRequest({ requestedRole, bindingHint }) as {
        requestedRole: RequestedRole;
        bindingHint?: string;
      };
      const result = responseData(await applicationApi.submit(
        request,
        idempotencyKey(String(identity.id), requestedRole),
      ));
      setApplication(result.application || null);
      setState(result.state || 'submitted');
      Taro.showToast({ title: '\u89d2\u8272\u7533\u8bf7\u5df2\u8fdb\u5165\u4e3b\u673a\u961f\u5217', icon: 'success' });
    } catch (error: any) {
      setState('invalid');
      Taro.showToast({ title: error?.message || '\u63d0\u4ea4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5', icon: 'none' });
    } finally {
      operationLock.current.release('submit');
    }
  };

  const copy = copyForApplicationState(state);
  const editable = ['not_submitted', 'invalid', 'rejected'].includes(state);

  return (
    <View className='application-page'>
      <View className={`state-card state-${state}`}>
        <Text className='state-kicker'>{'\u6570\u636e\u4e3b\u673a\u89d2\u8272\u6388\u6743'}</Text>
        <Text className='state-title'>{copy.title}</Text>
        <Text className='state-description'>{copy.description}</Text>
        {application?.commandId
          ? <Text className='task-reference'>{'\u547d\u4ee4\u7f16\u53f7\uff1a'}{application.commandId}</Text>
          : null}
      </View>

      {editable ? (
        <View className='application-form'>
          <Text className='section-title'>{'\u7533\u8bf7\u89d2\u8272'}</Text>
          <Picker
            mode='selector'
            range={ROLE_OPTIONS.map(option => option.label)}
            value={roleIndex}
            onChange={event => setRoleIndex(Number(event.detail.value))}
          >
            <View className='picker-value'>
              {ROLE_OPTIONS[roleIndex].label} <Text>{'\u203a'}</Text>
            </View>
          </Picker>

          <View className='field'>
            <Text className='label'>{'\u5df2\u6709\u6863\u6848\u7f16\u53f7\uff08\u9009\u586b\uff09'}</Text>
            <Input
              maxlength={128}
              value={bindingHint}
              onInput={event => setBindingHint(event.detail.value)}
              placeholder={'\u5982\u5df2\u77e5\u8001\u5e08/\u5b66\u751f\u6863\u6848\u7f16\u53f7\uff0c\u53ef\u586b\u5199'}
            />
            <Text className='field-tip'>{'\u6863\u6848\u7ed1\u5b9a\u4e0d\u662f\u89d2\u8272\u7533\u8bf7\u524d\u7f6e\u6761\u4ef6\uff0c\u6700\u7ec8\u7531\u6570\u636e\u4e3b\u673a\u8d85\u7ea7\u7ba1\u7406\u5458\u786e\u8ba4\u3002'}</Text>
          </View>

          <Button
            className='primary-action'
            disabled={state === 'submitting'}
            loading={state === 'submitting'}
            onClick={() => void submit()}
          >
            {'\u63d0\u4ea4\u89d2\u8272\u7533\u8bf7'}
          </Button>
        </View>
      ) : null}

      {['submitted', 'approved', 'offline', 'network_error'].includes(state)
        ? <Button className='secondary-action' onClick={() => void load()}>{'\u5237\u65b0\u72b6\u6001'}</Button>
        : null}
    </View>
  );
}
