#!/usr/bin/env python3
"""统一 LLM 客户端，支持 Gemini / OpenAI / DeepSeek / Qwen"""

import os
import requests
from abc import ABC, abstractmethod


class BaseLLM(ABC):
    @abstractmethod
    def generate(self, prompt: str, temperature: float = 0.7) -> str:
        pass


class GeminiLLM(BaseLLM):
    def __init__(self, api_key: str, api_base: str = "https://generativelanguage.googleapis.com/v1beta", model: str = "gemini-2.0-flash"):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.model = model

    def generate(self, prompt: str, temperature: float = 0.7) -> str:
        url = f"{self.api_base}/models/{self.model}:generateContent?key={self.api_key}"
        safe_url = url.replace(self.api_key, "***") if self.api_key else url
        print(f"Gemini请求: {safe_url}")
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature, "maxOutputTokens": 8192},
        }
        try:
            resp = requests.post(url, json=payload, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            return parts[0].get("text", "") if parts else ""
        except Exception as e:
            safe_err = str(e).replace(self.api_key, "***") if self.api_key else str(e)
            print(f"Gemini API 失败: {safe_err}")
            return ""


class OpenAILLM(BaseLLM):
    def __init__(self, api_key: str, api_base: str = "https://api.openai.com/v1", model: str = "gpt-4o"):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.model = model

    def generate(self, prompt: str, temperature: float = 0.7) -> str:
        url = f"{self.api_base}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        messages = [{"role": "user", "content": prompt}]
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": 4096,
        }
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            safe_err = str(e).replace(self.api_key, "***") if self.api_key else str(e)
            print(f"OpenAI API 失败: {safe_err}")
            return ""


class DeepSeekLLM(OpenAILLM):
    def __init__(self, api_key: str, api_base: str = "https://api.deepseek.com", model: str = "deepseek-chat"):
        super().__init__(api_key, api_base, model)


class QwenLLM(OpenAILLM):
    def __init__(self, api_key: str, api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1", model: str = "qwen-plus"):
        super().__init__(api_key, api_base, model)


PROVIDERS = {
    "gemini": GeminiLLM,
    "openai": OpenAILLM,
    "deepseek": DeepSeekLLM,
    "qwen": QwenLLM,
}


def create_llm() -> BaseLLM:
    """根据环境变量创建 LLM 客户端"""
    provider = os.environ.get("LLM_PROVIDER", "").lower()
    if not provider:
        raise ValueError("未配置 LLM_PROVIDER")

    api_key = os.environ.get("LLM_API_KEY", "")
    api_base = os.environ.get("LLM_API_BASE", "")
    model = os.environ.get("LLM_MODEL", "")

    if not api_key:
        raise ValueError(f"未配置 LLM_API_KEY")

    cls = PROVIDERS[provider]
    kwargs = {"api_key": api_key}
    if api_base:
        kwargs["api_base"] = api_base
    if model:
        kwargs["model"] = model
    return cls(**kwargs)
