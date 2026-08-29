import { useState } from 'react';
import { IconLock, IconUser, IconBrandHuawei } from './icons';

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
            <IconBrandHuawei size={40} />
          </div>
          <h1>MSS样品备货管理平台</h1>
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

        <div className="login-footer">
          <div className="default-accounts">
            <p className="default-title">默认测试账号：</p>
            <ul>
              <li>管理员：admin / Admin@123</li>
              <li>GTM：wanglu / 123456</li>
              <li>MSS领域接口人：zhaomin / 123456</li>
              <li>区域接口人：aaa / 123456</li>
              <li>备货接口人：chentao / 123456</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
