import { OpenAiCompatibleTextProvider } from '../openai-compatible-text-provider';

// DeepSeek serves OpenAI-compatible chat completions at /chat/completions.
// Vision requires a multimodal model such as deepseek-v4-flash-vision-exp;
// non-vision models reject image_url blocks with a 400 error.
export class DeepSeekTextProvider extends OpenAiCompatibleTextProvider {}
