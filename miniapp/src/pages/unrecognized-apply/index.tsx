import { useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, Picker, Button } from '@tarojs/components';
import { unrecognizedExperienceApi } from '../../utils/unrecognizedExperience';
import './index.scss';

const GRADE_OPTIONS = ['高一', '高二', '高三', '高复'];
const PARENT_ROLE_OPTIONS = ['爸爸', '妈妈'];

export default function UnrecognizedApplyPage() {
  const [type, setType] = useState<'student' | 'teacher'>('student');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [school, setSchool] = useState('');
  const [gradeIndex, setGradeIndex] = useState(0);
  const [parentRoleIndex, setParentRoleIndex] = useState(0);
  const [parentPhone, setParentPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    if (!phone.trim() || !/^1\d{10}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    if (type === 'student') {
      if (!school.trim()) {
        Taro.showToast({ title: '请输入学校', icon: 'none' });
        return;
      }
      if (!parentPhone.trim() || !/^1\d{10}$/.test(parentPhone)) {
        Taro.showToast({ title: '请输入正确的家长手机号', icon: 'none' });
        return;
      }
      if (phone === parentPhone) {
        Taro.showToast({ title: '学生手机号和家长手机号不能相同', icon: 'none' });
        return;
      }
    }

    if (type === 'teacher' && !subject.trim()) {
      Taro.showToast({ title: '请输入科目', icon: 'none' });
      return;
    }

    try {
      setLoading(true);
      await unrecognizedExperienceApi.submitApplication({
        type,
        name: name.trim(),
        phone: phone.trim(),
        school: type === 'student' ? school.trim() : undefined,
        grade: type === 'student' ? GRADE_OPTIONS[gradeIndex] : undefined,
        parentRole: type === 'student' ? PARENT_ROLE_OPTIONS[parentRoleIndex] : undefined,
        parentPhone: type === 'student' ? parentPhone.trim() : undefined,
        subject: type === 'teacher' ? subject.trim() : undefined,
        notes: notes.trim() || undefined,
      });

      Taro.showToast({ title: '申请提交成功', icon: 'success' });
      setTimeout(() => {
        Taro.navigateTo({ url: '/pages/unrecognized-status/index' });
      }, 1500);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '提交失败', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="apply-page">
      <View className="header">
        <Text className="title">申请正式账号</Text>
        <Text className="subtitle">提交申请后等待管理员审核</Text>
      </View>

      <View className="type-switch">
        <Button 
          className={`type-btn ${type === 'student' ? 'active' : ''}`}
          onClick={() => setType('student')}
        >
          学生
        </Button>
        <Button 
          className={`type-btn ${type === 'teacher' ? 'active' : ''}`}
          onClick={() => setType('teacher')}
        >
          老师
        </Button>
      </View>

      <View className="form">
        <View className="form-item">
          <Text className="label">姓名 *</Text>
          <Input 
            className="input"
            placeholder="请输入姓名"
            value={name}
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <View className="form-item">
          <Text className="label">手机号 *</Text>
          <Input 
            className="input"
            type="number"
            placeholder="请输入手机号"
            value={phone}
            onInput={(e) => setPhone(e.detail.value)}
          />
        </View>

        {type === 'student' && (
          <>
            <View className="form-item">
              <Text className="label">学校 *</Text>
              <Input 
                className="input"
                placeholder="请输入学校名称"
                value={school}
                onInput={(e) => setSchool(e.detail.value)}
              />
            </View>

            <View className="form-item">
              <Text className="label">当前年级 *</Text>
              <Picker 
                mode="selector" 
                range={GRADE_OPTIONS}
                value={gradeIndex}
                onChange={(e) => setGradeIndex(Number(e.detail.value))}
              >
                <View className="picker">
                  <Text>{GRADE_OPTIONS[gradeIndex]}</Text>
                  <Text className="arrow">▼</Text>
                </View>
              </Picker>
            </View>

            <View className="form-item">
              <Text className="label">家长角色 *</Text>
              <Picker 
                mode="selector" 
                range={PARENT_ROLE_OPTIONS}
                value={parentRoleIndex}
                onChange={(e) => setParentRoleIndex(Number(e.detail.value))}
              >
                <View className="picker">
                  <Text>{PARENT_ROLE_OPTIONS[parentRoleIndex]}</Text>
                  <Text className="arrow">▼</Text>
                </View>
              </Picker>
            </View>

            <View className="form-item">
              <Text className="label">家长手机号 *</Text>
              <Input 
                className="input"
                type="number"
                placeholder="请输入家长手机号"
                value={parentPhone}
                onInput={(e) => setParentPhone(e.detail.value)}
              />
            </View>
          </>
        )}

        {type === 'teacher' && (
          <View className="form-item">
            <Text className="label">科目 *</Text>
            <Input 
              className="input"
              placeholder="请输入科目（如：物理）"
              value={subject}
              onInput={(e) => setSubject(e.detail.value)}
            />
          </View>
        )}

        <View className="form-item">
          <Text className="label">备注</Text>
          <Input 
            className="input"
            placeholder="选填"
            value={notes}
            onInput={(e) => setNotes(e.detail.value)}
          />
        </View>
      </View>

      <Button 
        className="submit-btn"
        disabled={loading}
        onClick={handleSubmit}
      >
        {loading ? '提交中...' : '提交申请'}
      </Button>
    </View>
  );
}
