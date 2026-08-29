// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetProfitConfigModal } from '../../src/ui/features/netprofit/NetProfitConfigModal';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../src/domain/net-profit';
import type { NetProfitApi } from '../../src/shared/ipc-contract';

afterEach(cleanup);

function api(): NetProfitApi {
  return {
    getConfig: vi.fn(async () => ({
      config: { ...DEFAULT_NET_PROFIT_CONFIG },
      fxRates: { ...DEFAULT_FX_RATES, updatedAt: '2026-08-29T00:00:00.000Z' },
    })),
    saveConfig: vi.fn(async (config) => config),
    refreshRates: vi.fn(async () => ({ ...DEFAULT_FX_RATES, cny: 7.4, updatedAt: '2026-08-29T01:00:00.000Z' })),
  };
}

describe('NetProfitConfigModal', () => {
  it('loads the current config and renders the rate block', async () => {
    const a = api();
    render(<NetProfitConfigModal api={a} onClose={vi.fn()} />);

    await screen.findByLabelText('目标利润率（%）'); // 目标利润率
    expect(screen.getByText(/^CNY /)).toBeTruthy();
    expect(await screen.findByText(/2026-08-29T00:00:00.000Z/)).toBeTruthy();
  });

  it('saves a new target margin and closes', async () => {
    const a = api();
    const onClose = vi.fn();
    render(<NetProfitConfigModal api={a} onClose={onClose} />);

    const margin = await screen.findByLabelText('目标利润率（%）');
    fireEvent.change(margin, { target: { value: '30' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(a.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ targetMargin: 30 }),
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refreshes the fx rates in place', async () => {
    const a = api();
    render(<NetProfitConfigModal api={a} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('刷新汇率'));

    await waitFor(() => expect(a.refreshRates).toHaveBeenCalled());
    expect(await screen.findByText(/2026-08-29T01:00:00.000Z/)).toBeTruthy();
  });
});
