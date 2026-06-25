export class GeminiLLM {
  constructor(apiKey, apiBase = 'https://generativelanguage.googleapis.com/v1beta', model = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.model = model;
  }

  async generate(prompt, temperature = 0.7) {
    const url = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: 8192 },
    };
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 60000,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts[0]?.text || '';
      if (!text) throw new Error('未返回内容');
      return text;
    } catch (e) {
      console.error('Gemini API 失败:', e);
      throw new Error(`Gemini API 失败: ${e.message}`);
    }
  }
}

export class OpenAILLM {
  constructor(apiKey, apiBase = 'https://api.openai.com/v1', model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.model = model;
  }

  async generate(prompt, temperature = 0.7) {
    const url = `${this.apiBase}/chat/completions`;
    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: 4096,
    };
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 60000,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('未返回内容');
      return text;
    } catch (e) {
      console.error('OpenAI API 失败:', e);
      throw new Error(`OpenAI API 失败: ${e.message}`);
    }
  }
}

export class DeepSeekLLM extends OpenAILLM {
  constructor(apiKey, apiBase = 'https://api.deepseek.com', model = 'deepseek-chat') {
    super(apiKey, apiBase, model);
  }
}

export class QwenLLM extends OpenAILLM {
  constructor(apiKey, apiBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1', model = 'qwen-plus') {
    super(apiKey, apiBase, model);
  }
}

const PROVIDERS = {
  gemini: GeminiLLM,
  openai: OpenAILLM,
  deepseek: DeepSeekLLM,
  qwen: QwenLLM,
};

export function createLLM({ provider, apiKey, apiBase, model }) {
  const p = (provider || '').toLowerCase();
  if (!p) throw new Error('未配置 LLM_PROVIDER');
  if (!apiKey) throw new Error('未配置 LLM_API_KEY');
  const cls = PROVIDERS[p];
  if (!cls) throw new Error(`不支持的 LLM 提供商: ${provider}`);
  return new cls(apiKey, apiBase, model);
}
