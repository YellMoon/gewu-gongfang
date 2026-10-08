import React from 'react';

interface PageHeaderBarProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  status?: React.ReactNode;
}

const PageHeaderBar: React.FC<PageHeaderBarProps> = ({
  title,
  description,
  actions,
  secondaryActions,
  status,
}) => (
  <div className="page-header-bar">
    <div className="page-header-bar__main">
      <div className="page-header-bar__title-row">
        <h1 className="page-header-bar__title">{title}</h1>
        {description && <span className="page-header-bar__context">{description}</span>}
        {status && <div className="page-header-bar__status">{status}</div>}
      </div>
    </div>
    {(secondaryActions || actions) && (
      <div className="page-header-bar__actions">
        {secondaryActions && <div className="page-header-bar__secondary-actions">{secondaryActions}</div>}
        {actions && <div className="page-header-bar__primary-actions">{actions}</div>}
      </div>
    )}
  </div>
);

export default PageHeaderBar;
