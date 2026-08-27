import { OpenAiCompatibleTextProvider } from '../openai-compatible-text-provider';

// OpenAI serves compatible chat completions at /v1/chat/completions. Vision
// requires a model such as gpt-4o (image_url blocks are supported).
export class OpenAiTextProvider extends OpenAiCompatibleTextProvider {}
