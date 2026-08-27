import { useState } from 'react';

import { SettingsPage } from './pages/SettingsPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { WorkbenchPage } from './pages/WorkbenchPage';

const navigation = [
  { id: 'workbench', label: '工作台', symbol: '工' },
  { id: 'risk', label: '侵权检测', symbol: '检' },
  { id: 'edit', label: '产品编辑', symbol: '编' },
  { id: 'publish', label: '产品发布', symbol: '发' },
  { id: 'tasks', label: '任务记录', symbol: '任' },
  { id: 'settings', label: '模型与凭证', symbol: '配' },
  { id: 'help', label: '帮助与诊断', symbol: '诊' },
] as const;

type NavigationId = (typeof navigation)[number]['id'];

export function App() {
  const [activePage, setActivePage] = useState<NavigationId>('workbench');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const activeItem = navigation.find((item) => item.id === activePage)!;

  function navigate(nextPage: NavigationId) {
    if (
      activePage === 'settings' &&
      nextPage !== 'settings' &&
      settingsDirty &&
      !window.confirm('当前配置还有未保存修改，确定离开吗？')
    ) {
      return;
    }
    setActivePage(nextPage);
    setSettingsDirty(false);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>Mercado Agent</strong>
            <small>美客多智能工作台</small>
          </span>
        </div>

        <nav className="primary-navigation" aria-label="主要导航">
          {navigation.map((item) => (
            <button
              className={item.id === activePage ? 'nav-item active' : 'nav-item'}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className="nav-symbol" aria-hidden="true">
                {item.symbol}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>本地模式</strong>
            <small>数据仅保存在当前设备</small>
          </span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">MERCADO LIBRE OPERATIONS</p>
            <h1>{activeItem.label}</h1>
          </div>
          <div className="topbar-actions">
            <span className="environment-badge">纯本地桌面应用</span>
            <button className="secondary-button" type="button" onClick={() => navigate('help')}>
              连接状态
            </button>
          </div>
        </header>

        {activePage === 'workbench' ? (
          <WorkbenchPage />
        ) : activePage === 'settings' ? (
          <SettingsPage onDirtyChange={setSettingsDirty} />
        ) : activePage === 'help' ? (
          <DiagnosticsPage />
        ) : (
        <section className="workspace-card" aria-live="polite">
          <div className="workspace-intro">
            <span className="section-icon" aria-hidden="true">
              {activeItem.symbol}
            </span>
            <div>
              <h2>{activeItem.label}</h2>
              <p>应用基础框架已就绪，此业务区域将在对应验收任务中启用。</p>
            </div>
          </div>
          <div className="foundation-grid">
            <article>
              <span>01</span>
              <strong>侵权检测</strong>
              <p>先检测并保留风险证据，由用户决定是否继续。</p>
            </article>
            <article>
              <span>02</span>
              <strong>产品编辑</strong>
              <p>生成本地草稿，确认后保存妙手并回读核验。</p>
            </article>
            <article>
              <span>03</span>
              <strong>产品发布</strong>
              <p>独立提交发布，并持续追踪妙手异步队列。</p>
            </article>
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
