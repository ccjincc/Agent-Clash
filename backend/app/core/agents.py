import re
from typing import List, Dict


class Agent:
    def __init__(
        self,
        name: str,
        model: str,
        persona: str,
        client,
        avatar: str = None,
        custom_api_key: str = None,
        custom_base_url: str = None,
    ):
        self.name = name
        self.model = model
        self.persona = persona
        self.client = client
        self.custom_api_key = custom_api_key
        self.custom_base_url = custom_base_url

        self.avatar = avatar
        self.memory: List[Dict[str, str]] = []
        self.is_muted = False
        self.topic = ""
        self.search_enabled = False

    def set_muted(self, muted: bool):
        self.is_muted = muted

    def set_topic(self, topic: str):
        self.topic = topic

    def set_search_model_enabled(self, enabled: bool):
        self.search_enabled = enabled

    def receive_message(self, role: str, content: str):
        self.memory.append({"role": role, "content": content})

    def speak(self, prompt: str):
        system_msg = f"你是：{self.name}。\n你的设定是：{self.persona}。\n当前辩题/世界观是：{self.topic}"

        if self.search_enabled:
            system_msg += "\n[重要系统机制]：你拥有主动查阅历史和知识库的能力。如果你觉得当前信息不足，可以输出 `<SEARCH>你需要查询的关键词</SEARCH>`，系统会暂停你的发言，为你提供相关信息后让你继续。"

        messages = [{"role": "system", "content": system_msg}] + self.memory + [{"role": "user", "content": prompt}]

        try:
            client_to_use = self.client

            response = client_to_use.chat_completion(messages=messages, model=self.model, stream=True)

            usage_data = {}
            thinking_started = False
            thinking_ended = False

            for chunk in response:
                if hasattr(chunk, "usage") and chunk.usage:
                    usage_data = {
                        "prompt_tokens": getattr(chunk.usage, "prompt_tokens", 0),
                        "completion_tokens": getattr(chunk.usage, "completion_tokens", 0),
                        "total_tokens": getattr(chunk.usage, "total_tokens", 0),
                    }
                    yield {"type": "usage", "usage": usage_data}

                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta

                    delta_dict = delta.model_dump() if hasattr(delta, "model_dump") else (delta.dict() if hasattr(delta, "dict") else {})
                    if hasattr(delta, "__dict__"):
                        delta_dict.update(delta.__dict__)

                    reasoning_content = getattr(delta, "reasoning_content", None)
                    if not reasoning_content:
                        reasoning_content = delta_dict.get("reasoning_content") or delta_dict.get("reasoning")

                    if reasoning_content:
                        if not thinking_started:
                            yield {"type": "content", "content": "<think>\n"}
                            thinking_started = True
                        yield {"type": "content", "content": reasoning_content}

                    content = getattr(delta, "content", None)
                    if not content:
                        content = delta_dict.get("content")

                    if content:
                        if thinking_started and not thinking_ended:
                            yield {"type": "content", "content": "\n</think>\n\n"}
                            thinking_ended = True
                        yield {"type": "content", "content": content}

            if thinking_started and not thinking_ended:
                yield {"type": "content", "content": "\n</think>\n"}

        except Exception as e:
            yield {"type": "error", "message": f"Agent {self.name} API 调用失败: {str(e)}"}
