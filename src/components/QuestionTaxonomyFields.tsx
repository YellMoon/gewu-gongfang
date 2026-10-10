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
  if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前学科暂无体系，请在左侧新建体系" />;
  return <fieldset className="qb-taxonomy-editor" disabled={disabled} aria-label="体系打标">
    {rows.map(({ system, options }) => <div className="qb-choice-row" key={system.id} data-tagging-system={system.id}>
      <span className="qb-choice-label" title={system.name}>{system.name}：</span>
      <SearchTagPicker leafLabel label={system.name} options={options} values={value[system.id] || []}
        disabled={disabled} onChange={ids => onChange?.({ ...value, [system.id]: ids })} />
    </div>)}
  </fieldset>;
};
export default QuestionTaxonomyFields;
