import { useEffect, useState } from 'react';
import { Button, Checkbox, CheckboxGroup, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { unrecognizedExperienceApi, UnrecognizedQuestion, UnrecognizedTask } from '../../utils/unrecognizedExperience';
import { isUnrecognizedIdentity } from '../../utils/accountExperience';
import './index.scss';

const text = (...codes: number[]) => String.fromCharCode(...codes);
const COPY = Object.freeze({
  title: text(20307, 39564, 32452, 21367),
  subtitle: text(36873, 25321, 31034, 20363, 39064, 30446, 65292, 39044, 35272, 32452, 21367, 20869, 23481),
  paper: text(21019, 24314, 32452, 21367),
  loading: text(27491, 22312, 21152, 36733, 39064, 30446),
  empty: text(26242, 26080, 21487, 29992, 39064, 30446),
  failed: text(21152, 36733, 22833, 36133),
  name: text(35797, 21367, 21517, 31216),
  select: text(36873, 25321, 39064, 30446),
  refresh: text(21047, 26032),
  search: text(25628, 32034, 39064, 30446),
  submit: text(25552, 20132),
  submitted: text(32452, 21367, 24050, 25104),
  record: text(32452, 21367, 35760, 24405),
  noRecord: text(26242, 26080, 32452, 21367),
  apply: text(30003, 35831, 27491, 24335, 36134, 21495),
  chooseOne: text(35831, 33267, 36873, 25321, 19968, 36947, 39064),
  titleRequired: text(35831, 36755, 20837, 35797, 21367, 21517, 31216),
});

export default function UnrecognizedExperiencePanel() {
  const authorized = isUnrecognizedIdentity(Taro.getStorageSync('user_info'));
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [questions, setQuestions] = useState<UnrecognizedQuestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState(text(32451, 20064, 35797, 21367));
  const [tasks, setTasks] = useState<UnrecognizedTask[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadQuestions = async () => {
    setState('loading');
    try {
      const rows = await unrecognizedExperienceApi.getQuestions();
      setQuestions(rows);
      setState(rows.length ? 'ready' : 'empty');
    } catch (_error) {
      setState('error');
    }
  };

  useEffect(() => {
    if (!authorized) {
      Taro.reLaunch({ url: '/pages/login/index' });
      return undefined;
    }
    void loadQuestions();
    return undefined;
  }, [authorized]);

  const submit = async () => {
    if (!title.trim()) return void Taro.showToast({ title: COPY.titleRequired, icon: 'none' });
    if (!selectedIds.length) return void Taro.showToast({ title: COPY.chooseOne, icon: 'none' });
    setSubmitting(true);
    try {
      const task = await unrecognizedExperienceApi.createTask({ taskType: 'question-paper', title: title.trim(), questionIds: selectedIds });
      setTasks(previous => [task, ...previous]);
      Taro.showToast({ title: COPY.submitted, icon: 'success' });
    } catch (error: any) {
      Taro.showToast({ title: error?.message || COPY.failed, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = questions.filter(question => {
    const query = search.trim().toLowerCase();
    return !query || `${question.stemRichContent} ${question.type}`.toLowerCase().includes(query);
  });
  const statusText = state === 'loading' ? COPY.loading : state === 'empty' ? COPY.empty : COPY.failed;

  return (
    <View className='unrecognized-page'>
      <View className='hero-card'><Text className='hero-title'>{COPY.title}</Text><Text className='hero-subtitle'>{COPY.subtitle}</Text></View>
      <View className='form-card'>
        <View className='form-row'><Text className='field-label'>{COPY.name}</Text><Input className='field-input' value={title} onInput={event => setTitle(event.detail.value)} /></View>
      </View>
      <View className='preview-card'>
        <View className='preview-header'><Text className='preview-title'>{COPY.select} ({selectedIds.length})</Text><Button className='preview-refresh' onClick={() => void loadQuestions()}>{COPY.refresh}</Button></View>
        <Input className='preview-search' value={search} onInput={event => setSearch(event.detail.value)} placeholder={COPY.search} />
        {state !== 'ready' ? <View className='question-preview-empty'><Text>{statusText}</Text></View> : (
          <ScrollView className='question-preview-list' scrollY>
            <CheckboxGroup onChange={event => setSelectedIds(event.detail.value)}>
              {filtered.map(question => <View key={question.id} className={`question-preview-item ${selectedIds.includes(question.id) ? 'selected' : ''}`}>
                <Checkbox value={question.id} checked={selectedIds.includes(question.id)} />
                <View className='question-preview-meta'><Text>{question.type}</Text><Text>#{question.number}</Text></View>
                <Text className='question-preview-stem'>{String(question.stemRichContent)}</Text>
              </View>)}
            </CheckboxGroup>
          </ScrollView>
        )}
      </View>
      <View className='action-card'><Button className='action-button question-paper' loading={submitting} disabled={submitting || !selectedIds.length} onClick={() => void submit()}>{COPY.paper}</Button></View>
      <View className='result-card'>
        <Text className='preview-title'>{COPY.record}</Text>
        {tasks.length ? tasks.map(task => <View key={task.id} className='task-item'><Text className='result-text'>{task.request?.title || task.id}</Text><Text className='result-value'>{task.status} / {task.phase} / {task.progress}%</Text></View>) : <Text className='result-text'>{COPY.noRecord}</Text>}
      </View>
      <View className='apply-card'><Button className='apply-button' onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}>{COPY.apply}</Button></View>
    </View>
  );
}
