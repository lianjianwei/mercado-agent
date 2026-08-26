// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelProxyConfig } from '../../src/domain/proxy';
import type { ProxyConfigApi } from '../../src/shared/ipc-contract';
import { ProxyConfigForm } from '../../src/ui/features/settings/ProxyConfigForm';

afterEach(cleanup);

function fakeApi(): ProxyConfigApi {
  const disabled: ModelProxyConfig = {
    enabled: false,
    protocol: 'http',
    host: '',
    port: null,
  };
  return {
    get: vi.fn(async () => disabled),
    save: vi.fn(async (value) => value),
  };
}

describe('ProxyConfigForm', () => {
  it('starts disabled with no usable default address', async () => {
    render(<ProxyConfigForm api={fakeApi()} onDirtyChange={() => undefined} />);
    expect(await screen.findByRole('checkbox', { name: '启用 HTTP 代理' })).toHaveProperty('checked', false);
    expect(screen.getByLabelText('代理主机')).toHaveProperty('value', '');
    expect(screen.getByLabelText('代理端口')).toHaveProperty('value', '');
  });

  it('requires host and port only when enabled', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<ProxyConfigForm api={api} onDirtyChange={() => undefined} />);
    await user.click(await screen.findByRole('checkbox', { name: '启用 HTTP 代理' }));
    await user.click(screen.getByRole('button', { name: '保存代理配置' }));
    expect(await screen.findByText('启用代理时必须填写主机和端口。')).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('saves once and applies immediately', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<ProxyConfigForm api={api} onDirtyChange={() => undefined} />);
    await user.type(await screen.findByLabelText('代理主机'), '127.0.0.1');
    await user.type(screen.getByLabelText('代理端口'), '7890');
    await user.click(screen.getByRole('checkbox', { name: '启用 HTTP 代理' }));
    await user.click(screen.getByRole('button', { name: '保存代理配置' }));
    expect(await screen.findByText('模型网络代理配置已保存并生效。')).toBeTruthy();
    expect(api.save).toHaveBeenCalledWith({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
  });
});
