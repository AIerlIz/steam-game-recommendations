import type { LLMClient, LLMConfig } from '../types.js'

class GeminiLLM implements LLMClient {
  private apiKey: string
  private apiBase: string
  private model: string

  constructor(apiKey: string, apiBase = 'https://generativelanguage.googleapis.com/v1beta', model = 'gemini-2.0-flash') {
    this.apiKey = apiKey
    this.apiBase = apiBase.replace(/\/+$/, '')
    this.model = model
  }

  async generate(prompt: string, temperature = 0.7): Promise<string> {
    const url = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: 8192 },
    }
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`HTTP ${String(resp.status)} ${text.slice(0, 200)}`)
      }
      const data: { candidates?: { content?: { parts?: { text?: string }[] } }[] } = await resp.json()
      const parts = data.candidates?.[0]?.content?.parts || []
      const text = parts[0]?.text || ''
      if (!text) throw new Error('未返回内容')
      return text
    } catch (e) {
      console.error('Gemini API 失败:', e)
      throw new Error(`Gemini API 失败: ${(e as Error).message}`)
    }
  }
}

class OpenAILLM implements LLMClient {
  protected apiKey: string
  protected apiBase: string
  protected model: string

  constructor(apiKey: string, apiBase = 'https://api.openai.com/v1', model = 'gpt-4o') {
    this.apiKey = apiKey
    this.apiBase = apiBase.replace(/\/+$/, '')
    this.model = model
  }

  async generate(prompt: string, temperature = 0.7): Promise<string> {
    const url = `${this.apiBase}/chat/completions`
    const payload = {
      model: this.model,
      messages: [{ role: 'user' as const, content: prompt }],
      temperature,
      max_tokens: 4096,
    }
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`HTTP ${String(resp.status)} ${text.slice(0, 200)}`)
      }
      const data: { choices?: { message?: { content?: string } }[] } = await resp.json()
      const text = data.choices?.[0]?.message?.content || ''
      if (!text) throw new Error('未返回内容')
      return text
    } catch (e) {
      console.error('OpenAI API 失败:', e)
      throw new Error(`OpenAI API 失败: ${(e as Error).message}`)
    }
  }
}

class DeepSeekLLM extends OpenAILLM {
  constructor(apiKey: string, apiBase = 'https://api.deepseek.com', model = 'deepseek-chat') {
    super(apiKey, apiBase, model)
  }
}

class QwenLLM extends OpenAILLM {
  constructor(apiKey: string, apiBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1', model = 'qwen-plus') {
    super(apiKey, apiBase, model)
  }
}

const PROVIDERS = new Map<string, new (apiKey: string, apiBase?: string, model?: string) => LLMClient>([
  ['gemini', GeminiLLM],
  ['openai', OpenAILLM],
  ['deepseek', DeepSeekLLM],
  ['qwen', QwenLLM],
])

export function createLLM({ provider, apiKey, apiBase, model }: LLMConfig): LLMClient {
  const p = (provider || '').toLowerCase()
  if (!p) throw new Error('未配置 LLM_PROVIDER')
  if (!apiKey) throw new Error('未配置 LLM_API_KEY')
  const cls = PROVIDERS.get(p)
  if (!cls) throw new Error(`不支持的 LLM 提供商: ${provider}`)
  return new cls(apiKey, apiBase, model)
}
