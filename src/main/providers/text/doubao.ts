import { OpenAiCompatibleTextProvider } from '../openai-compatible-text-provider';

// Volcengine Ark (火山方舟) exposes an OpenAI-compatible chat endpoint at
// /api/v3/chat/completions. Configure the base URL accordingly; the model is
// usually a Doubao vision model (e.g. doubao-vision-pro).
export class DoubaoTextProvider extends OpenAiCompatibleTextProvider {}
