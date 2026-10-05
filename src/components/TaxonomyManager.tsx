import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Space, Tree, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import type { KnowledgeNode, TaxonomySystem } from '../types';
import { filterTaxonomyNodes, planTaxonomyDrop } from './taxonomyTreeOperations';
import './TaxonomyManager.css';

type Props = {
  subject: string;
  database: any;
  onChanged?: (systems: TaxonomySystem[], nodesBySystem: Record<string, KnowledgeNode[]>) => void;
};

const text = {
  addSystem: '\u65b0\u5efa\u4f53\u7cfb',
  systemName: '\u4f53\u7cfb\u540d\u79f0',
  rename: '\u91cd\u547d\u540d',
  removeSystem: '\u5220\u9664\u4f53\u7cfb',
  removeSystemBody: '\u5220\u9664\u540e\u5c06\u5728\u540c\u4e00\u4e8b\u52a1\u4e2d\u5220\u9664\u4f53\u7cfb\u53ca\u8282\u70b9\uff0c\u5e76\u6e05\u9664\u76f8\u5173\u8bd5\u9898\u6807\u6ce8\uff0c\u4e0d\u4f1a\u5220\u9664\u8bd5\u9898\u3002\u64cd\u4f5c\u524d\u4f1a\u81ea\u52a8\u4fdd\u7559\u53ef\u6062\u590d\u5907\u4efd\u548c\u5ba1\u8ba1\u8bb0\u5f55\u3002',
  addRoot: '\u65b0\u5efa\u6839\u8282\u70b9',
  addChild: '\u6dfb\u52a0\u5b50\u8282\u70b9',
  nodeName: '\u8282\u70b9\u540d\u79f0',
  removeNode: '\u5220\u9664\u8282\u70b9',
  removeNodeBody: '\u8be5\u8282\u70b9\u53ca\u6240\u6709\u5b50\u8282\u70b9\u5c06\u88ab\u5220\u9664\uff0c\u76f8\u5173\u8bd5\u9898\u6807\u6ce8\u5c06\u540c\u6b65\u6e05\u7406\u3002',
  backups: '\u5220\u9664\u5907\u4efd',
  restore: '\u6062\u590d',
  empty: '\u6682\u65e0\u4f53\u7cfb\uff0c\u53ef\u4ee5\u4e3a\u5f53\u524d\u5b66\u79d1\u65b0\u5efa\u3002',
};

function treeData(nodes: KnowledgeNode[], parentId?: string): any[] {
  return nodes
    .filter(node => (node.parent_id || '') === (parentId || ''))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((node, index, siblings) => ({ key: node.id, title: node.name, node, className: `${index === 0 ? 'taxonomy-node-first' : ''} ${index === siblings.length - 1 ? 'taxonomy-node-last' : ''}`, children: treeData(nodes, node.id) }));
}

type InlineEdit = { kind: 'system-create' | 'system-rename' | 'node-create' | 'node-rename'; system?: TaxonomySystem; node?: KnowledgeNode; value: string };

const TaxonomyManager: React.FC<Props> = ({ subject, database, onChanged }) => {
  const [systems, setSystems] = useState<TaxonomySystem[]>([]);
  const [nodesBySystem, setNodesBySystem] = useState<Record<string, KnowledgeNode[]>>({});
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [edit, setEdit] = useState<InlineEdit | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, React.Key[]>>({});

  const reload = useCallback(() => {
    const nextSystems: TaxonomySystem[] = database?.getTaxonomySystems?.(subject) || [];
    const nextNodes = Object.fromEntries(nextSystems.map(system => [system.id, database?.getTaxonomyNodes?.(system.id) || []]));
    setSystems(nextSystems);
    setNodesBySystem(nextNodes);
    onChanged?.(nextSystems, nextNodes);
  }, [database, onChanged, subject]);

  useEffect(() => {
    setEdit(null); setSearch(''); setExpanded({});
  }, [subject]);

  useEffect(() => {
    reload();
    window.addEventListener('authority-projection-refreshed', reload);
    return () => window.removeEventListener('authority-projection-refreshed', reload);
  }, [reload]);

  const saveEdit = () => {
    if (!edit) return;
    const name = edit.value.trim();
    if (!name) { message.warning(edit.kind.startsWith('system') ? '请输入体系名称' : '请输入节点名称'); return; }
    try {
      if (edit.kind === 'system-create') database.createTaxonomySystem({ name, subject });
      else if (edit.kind === 'system-rename') database.updateTaxonomySystem(edit.system!.id, { name });
      else if (edit.kind === 'node-rename') {
        if (!database.updateTaxonomyNode(edit.system!.id, edit.node!.id, { name })) throw new Error('节点保存失败');
      } else {
        const siblings = (nodesBySystem[edit.system!.id] || []).filter(node => (node.parent_id || '') === (edit.node?.id || ''));
        database.createTaxonomyNode(edit.system!.id, { name, parent_id: edit.node?.id, children: [], order: Math.max(-1, ...siblings.map(node => node.order)) + 1 });
      }
      setEdit(null); reload();
    } catch (error: any) { message.error(error?.message || String(error)); }
  };

  const inlineEditor = () => <div className="taxonomy-inline-editor" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Input autoFocus aria-label={edit?.kind.startsWith('system') ? '体系名称' : '节点名称'} size="small" value={edit?.value || ''}
      placeholder={edit?.kind.startsWith('system') ? '体系名称' : '节点名称'}
      onChange={event => setEdit(current => current ? { ...current, value: event.target.value } : null)}
      onPressEnter={event => { if (!(event.nativeEvent as KeyboardEvent).isComposing) saveEdit(); }}
      onKeyDown={event => { if (event.key === 'Escape') setEdit(null); }} />
    <div className="taxonomy-inline-editor__actions"><Button size="small" type="primary" onClick={saveEdit}>保存</Button><Button size="small" onClick={() => setEdit(null)}>取消</Button></div>
  </div>;

  const removeSystem = (system: TaxonomySystem) => {
    const impact = database.getTaxonomySystemDeletionImpact(system.id);
    if (!impact) return message.error('\u4f53\u7cfb\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664');
    Modal.confirm({
      title: `${text.removeSystem}: ${system.name}`,
      content: <Space direction="vertical">
        <strong>{`\u5c06\u5f71\u54cd ${impact.affected_question_count} \u9053\u8bd5\u9898\uff0c\u5220\u9664 ${impact.deleted_node_count} \u4e2a\u8282\u70b9\u3002`}</strong>
        <span>{text.removeSystemBody}</span>
      </Space>,
      okText: '\u5df2\u4e86\u89e3\u5f71\u54cd\uff0c\u7ee7\u7eed\u5220\u9664',
      cancelText: '\u53d6\u6d88',
      okButtonProps: { danger: true },
      onOk: () => {
        const result = database.deleteTaxonomySystem(system.id, {
          confirmed: true,
          expectedAffectedQuestionCount: impact.affected_question_count,
        });
        message.success(`\u5df2\u5220\u9664\uff0c\u53ef\u5728\u300c${text.backups}\u300d\u4e2d\u6062\u590d`);
        reload();
        return result;
      },
    });
  };

  const addNode = (system: TaxonomySystem, parent?: KnowledgeNode) => {
    setEdit({ kind: 'node-create', system, node: parent, value: '' });
    if (parent) setExpanded(current => ({ ...current, [system.id]: [...new Set([...(current[system.id] || []), parent.id])] }));
  };

  const renameNode = (system: TaxonomySystem, node: KnowledgeNode) => setEdit({ kind: 'node-rename', system, node, value: node.name });

  const dropNode = (system: TaxonomySystem, info: any) => {
    try {
      const dropPosition = info.dropPosition - Number(info.node.pos.split('-').pop());
      const updates = planTaxonomyDrop(nodesBySystem[system.id] || [], String(info.dragNode.key), String(info.node.key), dropPosition, info.dropToGap);
      for (const update of updates) {
        if (!database.updateTaxonomyNode(system.id, update.id, { parent_id: update.parent_id, order: update.order })) throw new Error('调序未完成，请刷新后重试');
      }
      reload();
      if (updates.length) message.success('节点位置已调整');
    } catch (error: any) { reload(); message.error(error?.message || String(error)); }
  };

  const systemTreeData = (system: TaxonomySystem) => {
    const nodes = filterTaxonomyNodes(nodesBySystem[system.id] || [], search);
    const data = treeData(nodes);
    if (edit?.kind === 'node-create' && edit.system?.id === system.id && edit.node) {
      const insert = (rows: any[]) => { for (const row of rows) { if (row.key === edit.node!.id) row.children.push({ key: '__taxonomy-inline-new', isLeaf: true, inlineDraft: true }); else insert(row.children); } };
      insert(data);
    }
    return data;
  };

  const removeNode = (system: TaxonomySystem, node: KnowledgeNode) => {
    const impact = database.getTaxonomyNodeDeletionImpact(system.id, node.id);
    if (!impact) return message.error('\u8282\u70b9\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664');
    Modal.confirm({
      title: `${text.removeNode}: ${node.name}`,
      content: <Space direction="vertical">
        <strong>{`\u5c06\u5f71\u54cd ${impact.affected_question_count} \u9053\u8bd5\u9898\uff0c\u5220\u9664 ${impact.deleted_node_count} \u4e2a\u8282\u70b9\u3002`}</strong>
        <span>{text.removeNodeBody}</span>
        <span>\u64cd\u4f5c\u524d\u4f1a\u81ea\u52a8\u4fdd\u7559\u53ef\u6062\u590d\u5907\u4efd\u548c\u5ba1\u8ba1\u8bb0\u5f55\u3002</span>
      </Space>,
      okText: '\u5df2\u4e86\u89e3\u5f71\u54cd\uff0c\u7ee7\u7eed\u5220\u9664',
      cancelText: '\u53d6\u6d88',
      okButtonProps: { danger: true },
      onOk: () => {
        const result = database.deleteTaxonomyNode(system.id, node.id, {
          confirmed: true,
          expectedAffectedQuestionCount: impact.affected_question_count,
        });
        message.success(`\u5df2\u5220\u9664\uff0c\u53ef\u5728\u300c${text.backups}\u300d\u4e2d\u6062\u590d`);
        reload();
        return result;
      },
    });
  };

  const showBackups = () => {
    setBackups(database.listTaxonomyDeletionBackups?.() || []);
    setBackupModalOpen(true);
  };

  const restoreBackup = (backupId: string) => {
    database.restoreTaxonomyDeletion(backupId);
    message.success('\u4f53\u7cfb\u548c\u8bd5\u9898\u6807\u6ce8\u5df2\u6062\u590d');
    setBackups(database.listTaxonomyDeletionBackups?.() || []);
    reload();
  };

  return <div className="taxonomy-manager">
    <div className="taxonomy-manager__actions">
      <Button icon={<PlusOutlined />} onClick={() => setEdit({ kind: 'system-create', value: '' })}>{text.addSystem}</Button>
      <Button icon={<HistoryOutlined />} onClick={showBackups}>{text.backups}</Button>
    </div>
    {edit?.kind === 'system-create' && inlineEditor()}
    <Input.Search className="taxonomy-search" allowClear aria-label="搜索体系节点" placeholder="搜索知识点或体系节点" value={search} onChange={event => setSearch(event.target.value)} />
    {systems.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text.empty} />}
    {systems.map((system, index) => <div key={system.id} className="taxonomy-system-block">
      <div className="taxonomy-system-title">
        {edit?.kind === 'system-rename' && edit.system?.id === system.id ? inlineEditor() : <strong>{index + 1}. {system.name}</strong>}
        <Space size={2}>
          <Tooltip title={text.rename}><Button type="text" size="small" aria-label={`重命名体系 ${system.name}`} icon={<EditOutlined />} onClick={() => setEdit({ kind: 'system-rename', system, value: system.name })} /></Tooltip>
          <Tooltip title={text.removeSystem}><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeSystem(system)} /></Tooltip>
        </Space>
      </div>
      <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => addNode(system)}>{text.addRoot}</Button>
      {edit?.kind === 'node-create' && edit.system?.id === system.id && !edit.node && inlineEditor()}
      <Tree
        className="taxonomy-tree"
        blockNode
        showLine={{ showLeafIcon: false }}
        switcherIcon={<span className="taxonomy-toggle" aria-hidden="true" />}
        expandedKeys={search.trim() ? (nodesBySystem[system.id] || []).map(node => node.id) : expanded[system.id] || []}
        onExpand={keys => setExpanded(current => ({ ...current, [system.id]: keys }))}
        draggable={edit || search.trim() ? false : { icon: false }}
        onDrop={info => dropNode(system, info)}
        treeData={systemTreeData(system)}
        titleRender={(treeNode: any) => treeNode.inlineDraft || (edit?.kind === 'node-rename' && edit.node?.id === treeNode.key) ? inlineEditor() : <div className="taxonomy-node-title" data-node-id={treeNode.key}>
          <span title={treeNode.node.name}>{treeNode.node.name}</span>
          <Space className="taxonomy-node-actions" size={0}>
            <Tooltip title={text.addChild}><Button type="text" size="small" aria-label={`添加子节点 ${treeNode.node.name}`} icon={<PlusOutlined />} onClick={event => { event.stopPropagation(); addNode(system, treeNode.node); }} /></Tooltip>
            <Tooltip title={text.rename}><Button type="text" size="small" aria-label={`重命名节点 ${treeNode.node.name}`} icon={<EditOutlined />} onClick={event => { event.stopPropagation(); renameNode(system, treeNode.node); }} /></Tooltip>
            <Tooltip title={text.removeNode}><Button type="text" danger size="small" aria-label={`删除节点 ${treeNode.node.name}`} icon={<DeleteOutlined />} onClick={event => { event.stopPropagation(); removeNode(system, treeNode.node); }} /></Tooltip>
          </Space>
        </div>}
      />
      {search.trim() && filterTaxonomyNodes(nodesBySystem[system.id] || [], search).length === 0 && <span className="taxonomy-no-match">无匹配节点</span>}
    </div>)}
    <Modal title={text.backups} open={backupModalOpen} footer={null} onCancel={() => setBackupModalOpen(false)}>
      {backups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="\u6682\u65e0\u4f53\u7cfb\u5220\u9664\u5907\u4efd" /> : backups.map((backup, index) => <div key={backup.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
        <div>
          <div>{index + 1}. {backup.entity_type === 'system' ? '\u4f53\u7cfb' : '\u8282\u70b9'}\u5220\u9664\uff1a\u5f71\u54cd {backup.affected_question_count} \u9053\u8bd5\u9898 / {backup.deleted_node_count} \u4e2a\u8282\u70b9</div>
          <small>{backup.created_at}</small>
        </div>
        <Button disabled={Boolean(backup.restored_at)} onClick={() => restoreBackup(backup.id)}>{backup.restored_at ? '\u5df2\u6062\u590d' : text.restore}</Button>
      </div>)}
    </Modal>
  </div>;
};

export default TaxonomyManager;
