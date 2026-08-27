import { createHmac } from 'node:crypto';

type MiaoshouSignatureInput = {
  appSecret: string;
  path: string;
  timestamp: string;
  appKey: string;
  bodyJson: string;
};

export function compactMiaoshouBody(
  body: Record<string, unknown> | undefined,
): string {
  return body === undefined ? '' : JSON.stringify(body);
}

export function createMiaoshouSignature({
  appSecret,
  path,
  timestamp,
  appKey,
  bodyJson,
}: MiaoshouSignatureInput): string {
  const content = `${appSecret}${path}${timestamp}${appKey}${bodyJson}${appSecret}`;
  return createHmac('sha256', appSecret).update(content).digest('hex');
}
