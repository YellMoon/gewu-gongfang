import React from 'react';
import { Alert } from 'antd';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message || '组件渲染异常' };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40 }}>
          <Alert
            message="页面加载异常"
            description={this.state.error}
            type="error"
            showIcon
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
