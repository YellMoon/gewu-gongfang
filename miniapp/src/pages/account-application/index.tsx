import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Checkbox, CheckboxGroup, Input, Picker, Text, View } from '@tarojs/components';
import { accountSessionCleanupStorageKeys, isUnrecognizedIdentity } from '../../utils/accountExperience';
import { authSessionRuntime } from '../../utils/authSession';
import { clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime';
import { clearBusinessCache } from '../../utils/storage';
import { unrecognizedExperienceApi } from '../../utils/unrecognizedExperience';
import {
  buildStudentApplicationPayload,
  buildTeacherApplicationPayload,
  copyForApplicationState,
  createApplicationOperationLock,
} from './applicationRuntime';
import './index.scss';

type ApplicationType = 'student' | 'teacher';
type ApplicantKind = 'student' | 'parent';

const GRADE_OPTIONS = ['高一', '高二', '高三', '高复'];
const PARENT_RELATIONS = ['爸爸', '妈妈'];

function createIdempotencyKey(userId: string): string {
  return `miniapp-application-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AccountApplicationPage() {
  const identity: any = Taro.getStorageSync('user_info') || {};
  const verifiedPhone = String(identity.phone || '').trim();
  const operationLock = useRef(createApplicationOperationLock());
  const [state, setState] = useState('loading');
  const [application, setApplication] = useState<any>(null);
  const [applicationType, setApplicationType] = useState<ApplicationType>('student');
  const [applicantKind, setApplicantKind] = useState<ApplicantKind>('student');
  const [name, setName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');
  const [school, setSchool] = useState('');
  const [gradeIndex, setGradeIndex] = useState(0);
  const [relationIndex, setRelationIndex] = useState(0);
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const hydrateForm = (nextApplication: any) => {
    if (!nextApplication?.payload) return;
    const payload = nextApplication.payload;
    const nextType = nextApplication.applicationType === 'teacher' ? 'teacher' : 'student';
    setApplicationType(nextType);
    setNotes(payload.notes || '');
    if (nextType === 'teacher') {
      setName(payload.name || '');
      setSubject(payload.subject || '');
      return;
    }
    const nextKind = nextApplication.applicantIdentityKind === 'parent' ? 'parent' : 'student';
    setApplicantKind(nextKind);
    setName(payload.studentName || '');
    setOtherPhone(nextKind === 'parent' ? payload.studentPhone || '' : payload.parentPhone || '');
    setSchool(payload.school || '');
    setGradeIndex(Math.max(0, GRADE_OPTIONS.indexOf(payload.currentGrade)));
    setRelationIndex(Math.max(0, PARENT_RELATIONS.indexOf(payload.parentRelation)));
    setConfirmed(false);
  };

  const load = async () => {
    setState('loading');
    try {
      const result = await unrecognizedExperienceApi.getApplicationStatus();
      const nextApplication = result.application || null;
      setApplication(nextApplication);
      setState(result.state || 'invalid');
      hydrateForm(nextApplication);
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      setState(message.includes('network') || message.includes('\u7f51\u7edc') ? 'offline' : 'network_error');
    }
  };

  useEffect(() => {
    if (!identity?.id || (!isUnrecognizedIdentity(identity) && identity.account_state !== 'formal')) {
      Taro.reLaunch({ url: '/pages/login/index' });
      return;
    }
    load();
  }, []);

  const submit = async () => {
    if (!operationLock.current.tryAcquire('submit')) return;
    setState('submitting');
    try {
      if (!verifiedPhone) throw new Error('当前账号没有可用的已验证手机号，请重新登录');
      const payload = applicationType === 'student'
        ? buildStudentApplicationPayload({
          applicantKind,
          verifiedPhone,
          studentName: name,
          otherPhone,
          school,
          currentGrade: GRADE_OPTIONS[gradeIndex],
          parentRelation: PARENT_RELATIONS[relationIndex],
          confirmation: confirmed,
          notes,
        })
        : buildTeacherApplicationPayload({ verifiedPhone, name, subject, notes });
      await unrecognizedExperienceApi.submitApplication(
        applicationType,
        payload,
        createIdempotencyKey(String(identity.id)),
      );
      Taro.showToast({ title: '申请已提交', icon: 'success' });
      await load();
    } catch (error: any) {
      setState('invalid');
      Taro.showToast({ title: error?.message || '提交失败，请核对资料', icon: 'none' });
    } finally {
      operationLock.current.release('submit');
    }
  };

  const withdraw = async () => {
    if (!application?.id || !operationLock.current.tryAcquire('withdraw')) return;
    try {
      const modal = await Taro.showModal({
        title: '撤回申请',
        content: '撤回后可修改资料并重新提交，是否继续？',
      });
      if (!modal.confirm) return;
      await unrecognizedExperienceApi.withdrawApplication(application.id);
      Taro.showToast({ title: '申请已撤回', icon: 'success' });
      await load();
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '撤回失败', icon: 'none' });
    } finally {
      operationLock.current.release('withdraw');
    }
  };

  const relogin = () => {
    clearAuthenticatedSession({
      invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
      clearBusinessCache,
      clearPermissionCache: () => Taro.removeStorageSync('user_permissions'),
      cleanupStorageKeys: () => accountSessionCleanupStorageKeys(),
      removeStorage: (key: string) => Taro.removeStorageSync(key),
    }, [identity]);
    Taro.reLaunch({ url: '/pages/login/index' });
  };

  const copy = copyForApplicationState(state);
  const editable = ['not_submitted', 'invalid', 'rejected', 'withdrawn'].includes(state);

  return (
    <View className='application-page'>
      <View className={`state-card state-${state}`}>
        <Text className='state-kicker'>正式账号</Text>
        <Text className='state-title'>{copy.title}</Text>
        <Text className='state-description'>{copy.description}</Text>
        {application?.rejectionReason && state === 'rejected'
          ? <Text className='rejection-reason'>退回原因：{application.rejectionReason}</Text>
          : null}
        {application?.hostTaskId && ['provisioning', 'manual_resolution_required'].includes(state)
          ? <Text className='task-reference'>建档任务：{application.hostTaskId}</Text>
          : null}
      </View>

      {editable ? (
        <View className='application-form'>
          <Text className='section-title'>申请身份</Text>
          <View className='segmented'>
            <Button className={applicationType === 'student' ? 'active' : ''} onClick={() => setApplicationType('student')}>学生</Button>
            <Button className={applicationType === 'teacher' ? 'active' : ''} onClick={() => setApplicationType('teacher')}>老师</Button>
          </View>

          {applicationType === 'student' ? (
            <>
              <Text className='section-title'>当前验证人</Text>
              <View className='segmented'>
                <Button className={applicantKind === 'student' ? 'active' : ''} onClick={() => { setApplicantKind('student'); setConfirmed(false); }}>学生本人</Button>
                <Button className={applicantKind === 'parent' ? 'active' : ''} onClick={() => { setApplicantKind('parent'); setConfirmed(false); }}>家长</Button>
              </View>
            </>
          ) : null}

          <View className='field'><Text className='label'>{applicationType === 'teacher' ? '老师姓名' : '学生姓名'} *</Text><Input value={name} onInput={event => setName(event.detail.value)} placeholder='请输入真实姓名' /></View>
          <View className='field locked'><Text className='label'>已验证手机号</Text><Text className='locked-value'>{verifiedPhone || '未读取到手机号'}</Text><Text className='field-tip'>该号码来自本次微信手机号验证，不可修改</Text></View>

          {applicationType === 'student' ? (
            <>
              <View className='field'><Text className='label'>{applicantKind === 'student' ? '家长手机号' : '学生手机号'} *</Text><Input type='number' maxlength={11} value={otherPhone} onInput={event => setOtherPhone(event.detail.value)} placeholder='请输入另一方手机号' /></View>
              <View className='field'><Text className='label'>学校 *</Text><Input value={school} onInput={event => setSchool(event.detail.value)} placeholder='请输入学校名称' /></View>
              <View className='field'><Text className='label'>当前年级 *</Text><Picker mode='selector' range={GRADE_OPTIONS} value={gradeIndex} onChange={event => setGradeIndex(Number(event.detail.value))}><View className='picker-value'>{GRADE_OPTIONS[gradeIndex]} <Text>›</Text></View></Picker></View>
              <View className='field'><Text className='label'>家长关系 *</Text><Picker mode='selector' range={PARENT_RELATIONS} value={relationIndex} onChange={event => setRelationIndex(Number(event.detail.value))}><View className='picker-value'>{PARENT_RELATIONS[relationIndex]} <Text>›</Text></View></Picker></View>
              <CheckboxGroup onChange={event => setConfirmed(event.detail.value.includes('confirmed'))}>
                <View className='confirmation'><Checkbox value='confirmed' checked={confirmed} color='#1f6f68' /><Text>{applicantKind === 'student' ? '本人已满 14 周岁，并确认由本人提交申请' : '我是该学生的监护人，并确认提交申请'}</Text></View>
              </CheckboxGroup>
            </>
          ) : (
            <View className='field'><Text className='label'>任教学科</Text><Input value={subject} onInput={event => setSubject(event.detail.value)} placeholder='选填，如物理' /></View>
          )}

          <View className='field'><Text className='label'>备注</Text><Input value={notes} onInput={event => setNotes(event.detail.value)} placeholder='选填，不超过 500 字' /></View>
          <Button className='primary-action' disabled={state === 'submitting'} loading={state === 'submitting'} onClick={submit}>{state === 'rejected' || state === 'withdrawn' ? '修改并重新提交' : '提交申请'}</Button>
        </View>
      ) : null}

      {state === 'submitted' ? <Button className='secondary-action danger' onClick={withdraw}>撤回申请</Button> : null}
      {state === 'approved_relogin_required' ? <Button className='primary-action standalone' onClick={relogin}>重新登录正式账号</Button> : null}
      {state === 'offline' || state === 'network_error' ? <Button className='secondary-action' onClick={load}>重新读取</Button> : null}
    </View>
  );
}
