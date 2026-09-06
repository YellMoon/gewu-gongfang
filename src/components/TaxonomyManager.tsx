import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Space, Tree, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import type { KnowledgeNode, TaxonomySystem } from '../types';

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
    .filter(node => node.parent_id === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(node => ({ key: node.id, title: node.name, node, children: treeData(nodes, node.id) }));
}

function prompt(title: string, initialValue = ''): Promise<string | null> {
  let value = initialValue;
  return new Promise(resolve => {
    Modal.confirm({
      title,
      content: <Input autoFocus defaultValue={initialValue} placeholder={title} onChange={event => { value = event.target.value; }} />,
      okText: '\u786e\u5b9a',
      cancelText: '\u53d6\u6d88',
      onOk: () => {
        const normalized = value.trim();
        if (!normalized) {
          message.warning(title);
          return Promise.reject();
        }
        resolve(normalized);
      },
      onCancel: () => resolve(null),
    });
  });
}

const TaxonomyManager: React.FC<Props> = ({ subject, database, onChanged }) => {
  const [systems, setSystems] = useState<TaxonomySystem[]>([]);
  const [nodesBySystem, setNodesBySystem] = useState<Record<string, KnowledgeNode[]>>({});
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);

  const reload = useCallback(() => {
    const nextSystems: TaxonomySystem[] = database?.getTaxonomySystems?.(subject) || [];
    const nextNodes = Object.fromEntries(nextSystems.map(system => [system.id, database?.getTaxonomyNodes?.(system.id) || []]));
    setSystems(nextSystems);
    setNodesBySystem(nextNodes);
    onChanged?.(nextSystems, nextNodes);
  }, [database, onChanged, subject]);

  useEffect(() => { reload(); }, [reload]);

  const addSystem = async () => {
    const name = await prompt(text.systemName);
    if (!name) return;
    try { database.createTaxonomySystem({ name, subject }); reload(); } catch (error: any) { message.error(error?.message || String(error)); }
  };

  const renameSystem = async (system: TaxonomySystem) => {
    const name = await prompt(text.systemName, system.name);
    if (!name || name === system.name) return;
    try { database.updateTaxonomySystem(system.id, { name }); reload(); } catch (error: any) { message.error(error?.message || String(error)); }
  };

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

  const addNode = async (system: TaxonomySystem, parent?: KnowledgeNode) => {
    const name = await prompt(text.nodeName);
    if (!name) return;
    database.createTaxonomyNode(system.id, { name, parent_id: parent?.id, children: [], order: (nodesBySystem[system.id] || []).length + 1 });
    reload();
  };

  const renameNode = async (system: TaxonomySystem, node: KnowledgeNode) => {
    const name = await prompt(text.nodeName, node.name);
    if (!name || name === node.name) return;
    database.updateTaxonomyNode(system.id, node.id, { name });
    reload();
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
      <Button icon={<PlusOutlined />} onClick={addSystem}>{text.addSystem}</Button>
      <Button icon={<HistoryOutlined />} onClick={showBackups}>{text.backups}</Button>
    </div>
    {systems.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text.empty} />}
    {systems.map(system => <div key={system.id} className="taxonomy-system-block">
      <div className="taxonomy-system-title">
        <strong>{system.name}</strong>
        <Space size={2}>
          <Tooltip title={text.rename}><Button type="text" size="small" icon={<EditOutlined />} onClick={() => renameSystem(system)} /></Tooltip>
          <Tooltip title={text.removeSystem}><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeSystem(system)} /></Tooltip>
        </Space>
      </div>
      <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => addNode(system)}>{text.addRoot}</Button>
      <Tree
        blockNode
        showLine={{ showLeafIcon: false }}
        treeData={treeData(nodesBySystem[system.id] || [])}
        titleRender={(treeNode: any) => <div className="taxonomy-node-title">
          <span>{treeNode.node.name}</span>
          <Space size={0}>
            <Tooltip title={text.addChild}><Button type="text" size="small" icon={<PlusOutlined />} onClick={event => { event.stopPropagation(); addNode(system, treeNode.node); }} /></Tooltip>
            <Tooltip title={text.rename}><Button type="text" size="small" icon={<EditOutlined />} onClick={event => { event.stopPropagation(); renameNode(system, treeNode.node); }} /></Tooltip>
            <Tooltip title={text.removeNode}><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={event => { event.stopPropagation(); removeNode(system, treeNode.node); }} /></Tooltip>
          </Space>
        </div>}
      />
    </div>)}
    <Modal title={text.backups} open={backupModalOpen} footer={null} onCancel={() => setBackupModalOpen(false)}>
      {backups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="\u6682\u65e0\u4f53\u7cfb\u5220\u9664\u5907\u4efd" /> : backups.map(backup => <div key={backup.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
        <div>
          <div>{backup.entity_type === 'system' ? '\u4f53\u7cfb' : '\u8282\u70b9'}\u5220\u9664\uff1a\u5f71\u54cd {backup.affected_question_count} \u9053\u8bd5\u9898 / {backup.deleted_node_count} \u4e2a\u8282\u70b9</div>
          <small>{backup.created_at}</small>
        </div>
        <Button disabled={Boolean(backup.restored_at)} onClick={() => restoreBackup(backup.id)}>{backup.restored_at ? '\u5df2\u6062\u590d' : text.restore}</Button>
      </div>)}
    </Modal>
  </div>;
};

export default TaxonomyManager;
