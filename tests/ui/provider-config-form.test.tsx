// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderConfigForm } from '../../src/ui/features/settings/ProviderConfigForm';
import type { ProviderConfigInput } from '../../src/domain/config';

afterEach(cleanup);

const base = {
  kind: 'text' as const,
  onDirtyChange: () => undefined,
  onSave: vi.fn(async () => undefined),
  onCancelEdit: () => undefined,
  codexAvailable: false,
};

describe('ProviderConfigForm reasoning effort', () => {
  it('shows the 推理强度 dropdown only for OpenAI text provider', async () => {
    const user = userEvent.setup();
    render(<ProviderConfigForm {...base} editing={null} />);

    // 未选提供商时不显示。
    expect(screen.queryByRole('combobox', { name: /推理强度/ })).toBeNull();

    // 选 OpenAI → 出现。
    await user.selectOptions(screen.getByLabelText('提供商'), 'openai');
    expect(await screen.findByRole('combobox', { name: /推理强度/ })).toBeTruthy();

    // 切到 DeepSeek → 消失。
    await user.selectOptions(screen.getByLabelText('提供商'), 'deepseek');
    expect(screen.queryByRole('combobox', { name: /推理强度/ })).toBeNull();
  });

  it('submits reasoningEffort with an OpenAI config', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_input: ProviderConfigInput) => undefined);
    render(<ProviderConfigForm {...base} onSave={save} editing={null} />);

    await user.selectOptions(screen.getByLabelText('提供商'), 'openai');
    await user.type(screen.getByLabelText('配置名称'), 'OpenAI 推理');
    await user.type(screen.getByLabelText('文本模型 API Key'), 'sk-test');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.86gamestore.com/v1');
    await user.type(screen.getByLabelText('模型名称'), 'gpt-5.6-terra');
    await user.selectOptions(screen.getByRole('combobox', { name: /推理强度/ }), 'high');
    await user.click(screen.getByRole('button', { name: '保存模型配置' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const input = save.mock.calls[0][0];
    expect(input).toMatchObject({
      kind: 'text',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    });
  });
});
