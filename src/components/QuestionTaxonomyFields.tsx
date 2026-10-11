import React, { useMemo } from 'react';
import { Empty } from 'antd';
import type { KnowledgeNode, TaxonomySystem } from '../types';
import { SearchTagPicker, taxonomyTagOptions } from './QuestionBankFilters';
import type { TaxonomyValues } from '../services/questionTaxonomyEditing';
import './QuestionTaxonomyFields.css';

const QuestionTaxonomyFields: React.FC<{
  systems: TaxonomySystem[];
  nodes: Record<string, KnowledgeNode[]>;
  value?: TaxonomyValues;
  onChange?: (value: TaxonomyValues) => void;
  disabled?: boolean;
}> = ({ systems, nodes, value = {}, onChange, disabled = false }) => {
  const rows = useMemo(() => [...systems].sort((a, b) => a.sort_no - b.sort_no).map(system => ({
    system, options: taxonomyTagOptions(nodes[system.id] || []),
  })), [systems, nodes]);
  if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u5f53\u524d\u5b66\u79d1\u6682\u65e0\u4f53\u7cfb\uff0c\u8bf7\u5148\u5728\u9898\u5e93\u9875\u9762\u65b0\u5efa\u4f53\u7cfb'} />;
  return <fieldset className="qb-taxonomy-editor" disabled={disabled} aria-label="体系打标">
    {rows.map(({ system, options }) => <div className="qb-choice-row" key={system.id} data-tagging-system={system.id}>
      <span className="qb-choice-label" title={system.name}>{system.name}：</span>
      <SearchTagPicker leafLabel label={system.name} options={options} values={value[system.id] || []}
        disabled={disabled} onChange={ids => onChange?.({ ...value, [system.id]: ids })} />
    </div>)}
  </fieldset>;
};
export default QuestionTaxonomyFields;
