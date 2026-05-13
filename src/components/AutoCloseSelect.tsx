import React from "react";
import { Select } from "antd";

/**
 * 统一下拉行为：除时间选择外，选中即收起
 */
function AutoCloseSelect(props: any) {
  const [open, setOpen] = React.useState<boolean>(false);
  return (
    <Select
      {...props}
      open={open}
      onDropdownVisibleChange={(v) => setOpen(v)}
      onChange={(value, option) => {
        props.onChange?.(value, option);
        // 选中后自动关闭（保留可扩展：props.autoClose === false 可禁用）
        if (props.autoClose !== false) setOpen(false);
      }}
    />
  );
}

(AutoCloseSelect as any).Option = Select.Option;
(AutoCloseSelect as any).OptGroup = Select.OptGroup;

export default AutoCloseSelect as any;
