import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // 更新state，下次渲染显示降级UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // 记录错误信息
    console.error('React Error Boundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRefresh = () => {
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      // 自定义降级UI
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠️</div>
            <h2 style={styles.title}>页面渲染出错</h2>
            <p style={styles.desc}>很抱歉，页面加载时出现了问题，请尝试刷新页面。</p>
            {this.state.error && (
              <details style={styles.details}>
                <summary>错误详情</summary>
                <pre style={styles.errorText}>{this.state.error.toString()}</pre>
              </details>
            )}
            <button onClick={this.handleRefresh} style={styles.button}>
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f7fa',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center',
  },
  icon: {
    fontSize: '64px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '24px',
    color: '#1f2937',
    margin: '0 0 12px 0',
  },
  desc: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 24px 0',
    lineHeight: 1.6,
  },
  details: {
    margin: '0 0 24px 0',
    textAlign: 'left',
    backgroundColor: '#f9fafb',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#374151',
  },
  errorText: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    margin: '8px 0 0 0',
  },
  button: {
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};

export default ErrorBoundary;
