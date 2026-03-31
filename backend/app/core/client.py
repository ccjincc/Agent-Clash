import os

import httpx
from openai import OpenAI


class DynamicClient:
    def __init__(self, api_key: str, base_url: str, timeout_seconds: float | None = None):
        if not api_key:
            api_key = "api-key-placeholder"
        if not base_url:
            base_url = "https://api.openai.com/v1"

        env_timeout = os.getenv("UPSTREAM_TIMEOUT_SECONDS") or os.getenv("OPENAI_TIMEOUT_SECONDS")
        t = timeout_seconds
        if t is None and env_timeout:
            try:
                t = float(env_timeout)
            except Exception:
                t = None
        if t is None:
            t = 120.0

        timeout = httpx.Timeout(t, connect=min(10.0, t), read=t, write=t, pool=t)
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)

    def chat_completion(self, messages, model, stream=True):
        try:
            has_image = False
            for m in messages:
                if isinstance(m.get("content"), list):
                    for part in m["content"]:
                        if part.get("type") == "image_url":
                            has_image = True
                            break
                if has_image:
                    break

            if has_image:
                vision_keywords = [
                    "vision",
                    "vl",
                    "gpt-4o",
                    "gpt-4.5",
                    "gpt-5",
                    "o1",
                    "o3",
                    "claude-3",
                    "claude-3.5",
                    "claude-3.7",
                    "claude-4",
                    "gemini-1.5",
                    "gemini-2.0",
                    "gemini-2.5",
                    "gemini-pro-vision",
                    "glm-4v",
                    "glm-5",
                    "qwen-vl",
                    "yi-vision",
                    "hunyuan-vision",
                    "pixtral",
                    "deepseek-vl",
                    "deepseek-vl2",
                    "deepseek-vl3",
                    "moonshot-v1-vision",
                    "kimi-k2.5",
                    "minimax-m2.5",
                    "minimax-m2.7",
                    "doubao-2.0",
                ]
                is_vision_model = any(k in model.lower() for k in vision_keywords)

                if not is_vision_model:
                    new_messages = []
                    for m in messages:
                        new_m = m.copy()
                        if isinstance(m.get("content"), list):
                            text_content = ""
                            for part in m["content"]:
                                if part.get("type") == "text":
                                    text_content += part.get("text", "")
                            new_m["content"] = text_content
                        new_messages.append(new_m)
                    messages = new_messages

            return self.client.chat.completions.create(model=model, messages=messages, stream=stream)
        except Exception as e:
            raise e

    def list_models(self):
        response = self.client.models.list()
        return sorted([model.id for model in response.data])
