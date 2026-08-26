// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiagnosticApi } from '../../src/shared/ipc-contract';
import type { ConnectionResult } from '../../src/domain/providers';
import { DiagnosticsPage } from '../../src/ui/pages/DiagnosticsPage';

afterEach(cleanup);

describe('DiagnosticsPage', () => {
  it('shows local environment and configuration completeness without secrets', async () => {
    const api: DiagnosticApi = {
      getSnapshot: async () => ({
        app: { version: '0.1.0', platform: 'darwin' },
        databasePath: '/Users/test/mercado-agent.sqlite3',
        completeness: {
          textProvider: true,
          imageProvider: false,
          miaoshou: true,
          qiniu: false,
        },
      }),
      testConnection: vi.fn(),
      cancelConnection: vi.fn(),
    };

    render(<DiagnosticsPage api={api} />);

    expect(await screen.findByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('macOS')).toBeTruthy();
    expect(screen.getByText('/Users/test/mercado-agent.sqlite3')).toBeTruthy();
    expect(screen.getAllByText('已完成')).toHaveLength(2);
    expect(screen.getAllByText('未完成')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('API Key');
    expect(document.body.textContent).not.toContain('Secret');
  });

  it('runs and cancels a connection test', async () => {
    const user = userEvent.setup();
    let resolveTest: ((value: ConnectionResult) => void) | undefined;
    const api: DiagnosticApi = {
      getSnapshot: async () => ({
        app: { version: '0.1.0', platform: 'win32' },
        databasePath: 'C:\\data\\mercado-agent.sqlite3',
        completeness: {
          textProvider: true,
          imageProvider: true,
          miaoshou: false,
          qiniu: false,
        },
      }),
      testConnection: vi.fn(
        () => new Promise<ConnectionResult>((resolve) => void (resolveTest = resolve)),
      ),
      cancelConnection: vi.fn(async () => {
        resolveTest?.({
          ok: false,
          status: 'cancelled',
          message: '连接测试已取消。',
          latencyMs: 1,
        });
      }),
    };
    render(<DiagnosticsPage api={api} />);

    await user.click(await screen.findByRole('button', { name: '测试文本模型连接' }));
    await user.click(screen.getByRole('button', { name: '取消文本模型测试' }));

    expect(api.cancelConnection).toHaveBeenCalledWith('text');
    expect(await screen.findByText('连接测试已取消。')).toBeTruthy();
  });
});
