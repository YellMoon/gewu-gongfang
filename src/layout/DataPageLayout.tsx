import React from 'react';
import { Card, Modal } from 'antd';

interface DataPageLayoutProps {
  children?: React.ReactNode;
  toolbar: React.ReactNode;
  table: React.ReactNode;
  modalOpen?: boolean;
  modalTitle?: React.ReactNode;
  modalContent?: React.ReactNode;
  onModalCancel?: () => void;
  modalWidth?: number | string;
  modalFooter?: React.ReactNode;
  destroyOnClose?: boolean;
}

const DataPageLayout: React.FC<DataPageLayoutProps> = ({
  children,
  toolbar,
  table,
  modalOpen,
  modalTitle,
  modalContent,
  onModalCancel,
  modalWidth = 520,
  modalFooter,
  destroyOnClose,
}) => {
  // UTF-8: retain each resource's original modal width, bounded on small screens.
  const responsiveModalWidth =
    typeof modalWidth === 'number'
      ? `min(${modalWidth}px, calc(100vw - 16px))`
      : modalWidth;

  return (
    <div className="data-page-layout">
      <Card className="data-page-layout__toolbar" size="small">
        {toolbar}
      </Card>
      <Card className="data-page-layout__table" size="small">
        {table}
      </Card>
      {children}
      {modalContent && (
        <Modal
          title={modalTitle}
          open={modalOpen}
          onCancel={onModalCancel}
          width={responsiveModalWidth}
          footer={modalFooter}
          destroyOnClose={destroyOnClose}
        >
          {modalContent}
        </Modal>
      )}
    </div>
  );
};

export default DataPageLayout;
