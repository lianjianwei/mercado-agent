// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogPanel } from '../../src/ui/components/LogPanel';

afterEach(cleanup);

const emptyLogs = { sync: [], infringement: [], publish: [] };
const onSelectTab = () => undefined;

describe('LogPanel', () => {
  it('shows category tabs and renders the active category log', () => {
    render(
      <LogPanel
        active="sync"
        logs={{ sync: ['第 1 页完成：20 条。'], infringement: [], publish: [] }}
        onSelectTab={onSelectTab}
      />,
    );

    expect(screen.getByRole('tab', { name: /同步日志/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /侵权检测日志/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /发布日志/ })).toBeTruthy();
    expect(screen.getByRole('log').textContent).toContain('第 1 页完成：20 条。');
  });

  it('renders the category whose tab is active and reports tab clicks', async () => {
    const user = userEvent.setup();
    const selectTab = vi.fn();
    render(
      <LogPanel
        active="infringement"
        logs={{
          sync: ['同步行'],
          infringement: ['检测行 A', '检测行 B'],
          publish: [],
        }}
        onSelectTab={selectTab}
      />,
    );

    const log = screen.getByRole('log');
    expect(log.textContent).toContain('检测行 A');
    expect(log.textContent).toContain('检测行 B');
    expect(log.textContent).not.toContain('同步行');

    await user.click(screen.getByRole('tab', { name: /同步日志/ }));
    expect(selectTab).toHaveBeenCalledWith('sync');
  });

  it('shows a per-category empty hint when the active log has no lines', () => {
    render(
      <LogPanel
        active="publish"
        logs={{ sync: [], infringement: ['检测行'], publish: [] }}
        onSelectTab={onSelectTab}
      />,
    );

    expect(screen.getByRole('log').textContent).toContain('等待发布日志…');
  });

  it('hides itself when every category is empty', () => {
    const { container } = render(<LogPanel active="sync" logs={emptyLogs} onSelectTab={onSelectTab} />);

    expect(container.querySelector('.log-panel')).toBeNull();
  });
});
