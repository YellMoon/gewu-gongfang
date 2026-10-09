import React, { useEffect, useMemo, useState } from 'react';
import { AutoComplete, Button, Checkbox, Drawer, InputNumber, Space, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import type { KnowledgeNode, TaxonomySystem } from '../types';
import { partitionedStorageKey } from '../services/desktopIdentityPartition.mjs';
import './QuestionBankFilters.css';

type Option = { value: string; label: string };
type Selection = { include: string[]; exclude: string[] };
type ChoiceRow = { id: string; label: string; options: Option[]; values: string[]; onChange: (values: string[]) => void };
type Props = {
  subject: string;
  actions?: React.ReactNode;
  rows: ChoiceRow[];
  years: Option[];
  selectedYears: string[];
  onYearsChange: (values: string[]) => void;
  metadataRows: ChoiceRow[];
  systems: TaxonomySystem[];
  nodes: Record<string, KnowledgeNode[]>;
  selections: Record<string, Selection>;
  onSelectionChange: (systemId: string, mode: 'include' | 'exclude', values: string[]) => void;
};
type Preferences = { order: string[]; hidden: string[]; gap: number; labelWidth: number; mergeFixed: boolean };
// 新增按账号与学科保存的筛选布局设置。
const defaults: Preferences = { order: ['exam', 'type', 'status', 'difficulty', 'grade', 'semester', 'year', 'sources', 'regions', 'schools', 'taxonomy'], hidden: [], gap: 3, labelWidth: 76, mergeFixed: true };

function readPreferences(key: string): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved) return defaults;
    return {
      order: Array.isArray(saved.order) ? [...new Set<string>([...saved.order.filter((id: string) => defaults.order.includes(id)), ...defaults.order])] : defaults.order,
      mergeFixed: saved.mergeFixed !== false,
      hidden: Array.isArray(saved.hidden) ? saved.hidden.filter((id: string) => defaults.order.includes(id)) : [],
      gap: Number.isFinite(saved.gap) ? Math.max(0, Math.min(20, saved.gap)) : defaults.gap,
      labelWidth: Number.isFinite(saved.labelWidth) ? Math.max(70, Math.min(160, saved.labelWidth)) : defaults.labelWidth,
    };
  } catch { return defaults; }
}

export function taxonomyTagOptions(nodes: KnowledgeNode[]): Option[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.map(node => {
    const names = [node.name], seen = new Set([node.id]);
    let parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id); names.unshift(parent.name);
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
    }
    return { value: node.id, label: names.join(' / ') };
  });
}

export const SearchTagPicker: React.FC<{ label: string; options: Option[]; values: string[]; onChange: (values: string[]) => void; leafLabel?: boolean }> = ({ label, options, values, onChange, leafLabel = false }) => {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const candidates = useMemo(() => options.filter(option => !values.includes(option.value) && option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [options, values, search]);
  const confirm = () => {
    const option = options.find(item => !values.includes(item.value) && (item.value === selected || item.label === search.trim()));
    if (!option) { message.info('请从搜索结果中选择已有标签'); return; }
    onChange([...values, option.value]); setEditing(false); setSearch(''); setSelected(undefined);
  };
  return <div className="qb-tag-picker" aria-label={label}>
    {values.map(value => <span className="qb-filter-text-tag" key={value}>
      <span title={options.find(option => option.value === value)?.label}>{leafLabel ? (options.find(option => option.value === value)?.label.split(' / ').pop() || value) : (options.find(option => option.value === value)?.label || value)}</span>
      <button type="button" aria-label={'移除' + label + ' ' + (options.find(option => option.value === value)?.label || value)} onClick={() => onChange(values.filter(id => id !== value))}><CloseOutlined /></button>
    </span>)}
    {editing ? <Space size={4} className="qb-tag-editor">
      <AutoComplete autoFocus value={search} options={candidates} aria-label={'搜索' + label}
        placeholder={'搜索' + label} notFoundContent="无匹配标签" filterOption={false}
        onSearch={value => { setSearch(value); setSelected(undefined); }}
        onSelect={(value, option) => { setSelected(value); setSearch(String(option.label)); }}
        onKeyDown={event => { if (event.key === 'Enter' && !(event.nativeEvent as KeyboardEvent).isComposing) confirm(); if (event.key === 'Escape') setEditing(false); }} />
      <Button size="small" type="link" onClick={confirm}>确定</Button>
      <Button size="small" type="text" aria-label={'取消添加' + label} icon={<CloseOutlined />} onClick={() => setEditing(false)} />
    </Space> : <Button className="qb-filter-add" size="small" type="text" aria-label={'添加' + label} icon={<PlusOutlined />} onClick={() => { setEditing(true); setSearch(''); setSelected(undefined); }} />}
  </div>;
};

const QuestionBankFilters: React.FC<Props> = ({ subject, actions, rows, years, selectedYears, onYearsChange, metadataRows, systems, nodes, selections, onSelectionChange }) => {
  const storageKey = partitionedStorageKey('question_filter_layout_v1:' + subject);
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extraSystems, setExtraSystems] = useState<string[]>([]);
  useEffect(() => { setPreferences(readPreferences(storageKey)); setExtraSystems([]); }, [storageKey]);
  const updatePreferences = (next: Preferences) => { setPreferences(next); localStorage.setItem(storageKey, JSON.stringify(next)); };
  useEffect(() => {
    if (preferences.hidden.includes('taxonomy') && Object.values(selections).some(selection => selection.include.length || selection.exclude.length)) {
      const next = { ...preferences, hidden: preferences.hidden.filter(id => id !== 'taxonomy') };
      setPreferences(next);
      localStorage.setItem(storageKey, JSON.stringify(next));
    }
  }, [preferences, selections, storageKey]);
  const orderedSystems = [...systems].sort((a, b) => a.sort_no - b.sort_no);
  const visibleSystems = orderedSystems.filter((system, index) => index < 3 || extraSystems.includes(system.id) || selections[system.id]?.include.length || selections[system.id]?.exclude.length);
  const nextSystem = orderedSystems.find(system => !visibleSystems.includes(system));
  const rowLabels = Object.fromEntries([...rows.map(row => [row.id, row.label]), ...metadataRows.map(row => [row.id, row.label]), ['year', '学年'], ['taxonomy', '体系标签']]);
  const toggle = (row: ChoiceRow, value: string) => {
    if (value === '全部') return row.onChange(['全部']);
    const active = row.values.filter(item => item !== '全部');
    const next = active.includes(value) ? active.filter(item => item !== value) : [...active, value];
    row.onChange(next.length ? next : ['全部']);
  };
  const move = (id: string, direction: number) => {
    const order = [...preferences.order], index = order.indexOf(id), target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updatePreferences({ ...preferences, order });
  };
  const settingsButton = <Button aria-label="调整筛选栏" type="link" size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>调整筛选栏</Button>;
  return <div className="qb-row-filters" style={{ '--qb-filter-gap': preferences.gap + 'px', '--qb-filter-label-width': preferences.labelWidth + 'px' } as React.CSSProperties}>
    <div className="qb-filter-lines">
    {preferences.order.map(id => {
      if (preferences.hidden.includes(id)) return null;
      const metadataRow = metadataRows.find(row => row.id === id);
      if (metadataRow) return <div className={'qb-choice-row qb-metadata-choice' + (preferences.mergeFixed ? ' qb-choice-group qb-choice-group--' + id : '')} key={id} data-filter-row={id}>
        <span className="qb-choice-label">{metadataRow.label}：</span>
        <div className="qb-choice-values">
          <button type="button" aria-pressed={!metadataRow.values.length} className={!metadataRow.values.length ? 'qb-choice active' : 'qb-choice'} onClick={() => metadataRow.onChange([])}>全部</button>
          <SearchTagPicker label={metadataRow.label} options={metadataRow.options} values={metadataRow.values} onChange={metadataRow.onChange} />
        </div>
      </div>;
      if (id === 'year') return <div className="qb-choice-row" key={id}><span className="qb-choice-label">学年：</span><div className="qb-choice-values"><button type="button" aria-pressed={!selectedYears.length} className={!selectedYears.length ? 'qb-choice active' : 'qb-choice'} onClick={() => onYearsChange([])}>全部</button><SearchTagPicker key={subject} label="学年" options={years} values={selectedYears} onChange={onYearsChange} /></div></div>;
      if (id === 'taxonomy') return <div className="qb-taxonomy-filter-rows" key={id}>
        {visibleSystems.map(system => <div className="qb-choice-row" key={system.id} data-filter-system={system.id}>
          <span className="qb-choice-label" title={system.name}>{system.name}：</span>
          <div className="qb-taxonomy-conditions">
            {(['include', 'exclude'] as const).map(mode => <div className="qb-taxonomy-condition" key={mode} data-mode={mode}>
              <span>{mode === 'include' ? '包含' : '排除'}</span>
              <SearchTagPicker leafLabel label={system.name + (mode === 'include' ? '包含' : '排除')} options={taxonomyTagOptions(nodes[system.id] || [])} values={selections[system.id]?.[mode] || []} onChange={values => onSelectionChange(system.id, mode, values)} />
            </div>)}
          </div>
        </div>)}
      </div>;
      const row = rows.find(item => item.id === id);
      return row ? <div className={'qb-choice-row' + (id === 'exam' ? ' qb-choice-row--exam' : '') + (preferences.mergeFixed && id !== 'exam' ? ' qb-choice-group qb-choice-group--' + id : '')} key={id} data-filter-row={id}>
        <span className="qb-choice-label">{row.label}：</span>
        <div className="qb-choice-values">{row.options.map(option => <button type="button" key={option.value} aria-pressed={row.values.includes(option.value)} className={row.values.includes(option.value) ? 'qb-choice active' : 'qb-choice'} onClick={() => toggle(row, option.value)}>{option.label}</button>)}</div>
        {id === 'exam' && settingsButton}
      </div> : null;
    })}
    </div>
    <div className="qb-filter-row qb-filter-actions">
        {(!systems.length || nextSystem) && <Button aria-label="添加新标签筛选" type="link" className="qb-add-system-filter" icon={<PlusOutlined />} onClick={() => {
          if (!systems.length) message.info('目前尚未设置体系并打标，请先在左侧新建体系，为试题关联标签后再筛选');
          else if (nextSystem) setExtraSystems(current => [...current, nextSystem.id]);
        }}>添加新标签筛选</Button>}
      {actions}
      {preferences.hidden.includes('exam') && settingsButton}
    </div>
    <Drawer title="调整筛选栏" open={settingsOpen} onClose={() => setSettingsOpen(false)} width={420}>
      <p className="qb-filter-setting-description">勾选显示的行，用箭头调整顺序。设置保存在当前账号和电脑，按学科分别记住；隐藏筛选行会清空该行条件。</p>
      <Checkbox checked={preferences.mergeFixed} onChange={event => updatePreferences({ ...preferences, mergeFixed: event.target.checked })}>合并固定选项到同一行</Checkbox>
      {preferences.order.map((id, index) => <div className="qb-filter-setting-row" key={id}>
        <Checkbox checked={!preferences.hidden.includes(id)} onChange={event => {
          if (!event.target.checked) {
            const row = rows.find(item => item.id === id);
            row?.onChange(['全部']);
            metadataRows.find(item => item.id === id)?.onChange([]);
            if (id === 'year') onYearsChange([]);
            if (id === 'taxonomy') systems.forEach(system => { onSelectionChange(system.id, 'include', []); onSelectionChange(system.id, 'exclude', []); });
          }
          updatePreferences({ ...preferences, hidden: event.target.checked ? preferences.hidden.filter(value => value !== id) : [...preferences.hidden, id] });
        }}>{rowLabels[id]}</Checkbox>
        <Space><Button size="small" aria-label={'上移' + rowLabels[id]} disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => move(id, -1)} /><Button size="small" aria-label={'下移' + rowLabels[id]} disabled={index === preferences.order.length - 1} icon={<ArrowDownOutlined />} onClick={() => move(id, 1)} /></Space>
      </div>)}
      <div className="qb-filter-setting-row"><span>行间距（px）</span><InputNumber aria-label="筛选行间距" min={0} max={20} value={preferences.gap} onChange={value => value !== null && updatePreferences({ ...preferences, gap: value })} /></div>
      <div className="qb-filter-setting-row"><span>标签栏宽度（px）</span><InputNumber aria-label="筛选标签栏宽度" min={70} max={160} value={preferences.labelWidth} onChange={value => value !== null && updatePreferences({ ...preferences, labelWidth: value })} /></div>
      <Button onClick={() => updatePreferences(defaults)}>恢复默认布局</Button>
    </Drawer>
  </div>;
};
export default QuestionBankFilters;
