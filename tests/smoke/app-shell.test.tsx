import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '../../src/ui/App';

describe('application shell', () => {
  it('renders every approved primary navigation destination', () => {
    const html = renderToStaticMarkup(<App />);

    for (const label of [
      '工作台',
      '产品发布',
      '任务记录',
      '模型与凭证',
      '帮助与诊断',
    ]) {
      expect(html).toContain(label);
    }
  });
});
