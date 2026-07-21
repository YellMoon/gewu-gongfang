import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Space, Tree, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
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
  removeSystemBody: '\u5220\u9664\u540e\u5c06\u540c\u65f6\u6e05\u9664\u6240\u6709\u8bd5\u9898\u5728\u8be5\u4f53\u7cfb\u4e0b\u7684\u6807\u6ce8\uff0c\u4e0d\u4f1a\u5220\u9664\u8bd5\u9898\u3002',
  addRoot: '\u65b0\u5efa\u6839\u8282\u70b9',
  addChild: '\u6dfb\u52a0\u5b50\u8282\u70b9',
  nodeName: '\u8282\u70b9\u540d\u79f0',
  removeNode: '\u5220\u9664\u8282\u70b9',
  removeNodeBody: '\u8be5\u8282\u70b9\u53ca\u6240\u6709\u5b50\u8282\u70b9\u5c06\u88ab\u5220\u9664\uff0c\u76f8\u5173\u8bd5\u9898\u6807\u6ce8\u5c06\u540c\u6b65\u6e05\u7406\u3002',
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

  const removeSystem = (system: TaxonomySystem) => Modal.confirm({
    title: `${text.removeSystem}: ${system.name}`,
    content: text.removeSystemBody,
    okText: text.removeSystem,
    cancelText: '\u53d6\u6d88',
    okButtonProps: { danger: true },
    onOk: () => { database.deleteTaxonomySystem(system.id); reload(); },
  });

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

  const removeNode = (system: TaxonomySystem, node: KnowledgeNode) => Modal.confirm({
    title: `${text.removeNode}: ${node.name}`,
    content: text.removeNodeBody,
    okText: text.removeNode,
    cancelText: '\u53d6\u6d88',
    okButtonProps: { danger: true },
    onOk: () => { database.deleteTaxonomyNode(system.id, node.id); reload(); },
  });

  return <div className="taxonomy-manager">
    <Button block icon={<PlusOutlined />} onClick={addSystem}>{text.addSystem}</Button>
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
  </div>;
};

export default TaxonomyManager;
