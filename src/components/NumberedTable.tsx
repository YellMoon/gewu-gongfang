import React, { useState } from 'react';
import { Table } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType, ColumnFilterItem } from 'antd/es/table/interface';

function filterColumns<T extends object>(columns: NonNullable<TableProps<T>['columns']>, parent = ''): Array<{ column: ColumnType<T>; key: string }> {
  return columns.flatMap((column, index) => {
    // The sequence column occupies position zero in the table passed to AntD.
    const position = parent ? `${parent}-${index}` : String(index + 1);
    const dataIndex = 'dataIndex' in column ? column.dataIndex : undefined;
    const key = String(column.key ?? (Array.isArray(dataIndex) ? dataIndex.join('.') : dataIndex) ?? position);
    return [{ column, key }, ...('children' in column ? filterColumns(column.children, position) : [])];
  });
}

function filterKeys(filters: ColumnFilterItem[] = []): Array<React.Key | boolean> {
  return filters.flatMap(filter => [filter.value, ...filterKeys(filter.children)]);
}

/** Business tables share a visible-order number; record IDs remain unchanged. */
function NumberedTable<RecordType extends object = any>({
  columns = [], pagination, dataSource, onChange, ...props
}: TableProps<RecordType>) {
  const config = pagination === false ? undefined : pagination;
  const [page, setPage] = useState({
    current: config?.defaultCurrent ?? 1,
    pageSize: config?.defaultPageSize ?? 10,
  });
  const entries = filterColumns(columns);
  const [filters, setFilters] = useState<Record<string, ColumnType<RecordType>['filteredValue']>>(() =>
    Object.fromEntries(entries.map(({ column, key }) => [key, column.defaultFilteredValue])));
  const pageSize = config?.pageSize ?? page.pageSize;
  // Filters survive data refreshes in AntD. Recompute the result size from the
  // current records, including initial/default and externally controlled filters.
  const filteredCount = (dataSource || []).filter(record => entries.every(({ column, key }) => {
    const selected = 'filteredValue' in column ? column.filteredValue : filters[key];
    if (!column.onFilter || !selected?.length) return true;
    const keys = filterKeys(column.filters);
    return selected.some(value => column.onFilter!(keys.find(key => String(key) === String(value)) ?? value, record));
  })).length;
  const total = config?.total || filteredCount;
  const current = Math.min(config?.current ?? page.current, Math.max(1, Math.ceil(total / pageSize)));
  const offset = pagination === false ? 0 : (current - 1) * pageSize;
  const numberedColumns: TableProps<RecordType>['columns'] = [{
    title: '序号', key: '__visible_row_number__', width: 64, align: 'center',
    fixed: columns.some(column => column.fixed === 'left' || column.fixed === true) ? 'left' : undefined,
    render: (_value, _record, index) => offset + index + 1,
  }, ...columns];

  return <Table<RecordType>
    {...props}
    dataSource={dataSource}
    columns={numberedColumns}
    pagination={pagination}
    onChange={(nextPagination, nextFilters, sorter, extra) => {
      setPage({ current: nextPagination.current ?? 1, pageSize: nextPagination.pageSize ?? pageSize });
      setFilters(nextFilters);
      onChange?.(nextPagination, nextFilters, sorter, extra);
    }}
  />;
}

export default NumberedTable;
