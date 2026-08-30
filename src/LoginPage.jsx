import { useState } from 'react';
import { IconBox, IconLock, IconUser } from '@tabler/icons-react';

export default function LoginPage({ onLogin, loading }) {
  const [employeeNo, setEmployeeNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!employeeNo.trim() || !password.trim()) {
      setError('请输入工号和密码');
      return;
    }
    setSubmitting(true);
    try {
      await onLogin(employeeNo.trim(), password);
    } catch (err) {
      setError(err.message || '登录失败，请检查工号和密码');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <IconBox size={40} />
          </div>
          <h1>MSS样机备货管理平台</h1>
          <p className="login-subtitle">Sample Stocking Management Platform</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="employeeNo">工号</label>
            <div className="input-with-icon">
              <IconUser size={18} />
              <input
                id="employeeNo"
                type="text"
                value={employeeNo}
                onChange={(e) => setEmployeeNo(e.target.value)}
                placeholder="请输入工号"
                autoComplete="username"
                disabled={submitting || loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">密码</label>
            <div className="input-with-icon">
              <IconLock size={18} />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                disabled={submitting || loading}
              />
            </div>
          </div>

          <button
            type="submit"
            className="button button-primary login-button"
            disabled={submitting || loading}
          >
            {submitting || loading ? '登录中...' : '登 录'}
          </button>
        </form>

        <div className="login-footer">请使用已分配的企业账号登录</div>
      </div>
    </div>
  );
}
