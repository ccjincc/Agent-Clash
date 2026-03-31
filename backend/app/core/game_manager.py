import time
import json
import re
from datetime import datetime
from typing import List, Dict, Optional
from app.core.client import DynamicClient
from app.core.agents import Agent
from app.db.database import SessionLocal, SessionModel, AgentModel, MessageModel, SessionMetaModel


class DebateSession:
    def __init__(self, session_id: str, api_key: str, base_url: str):
        self.session_id = session_id
        self.client = DynamicClient(api_key=api_key, base_url=base_url)
        self.agents: List[Agent] = []
        self.topic: str = ""
        self.max_rounds: int = 10
        self.current_round: int = 0
        self.state: str = "IDLE"
        self.history: List[Dict[str, str]] = []
        self.stop_requested: bool = False
        self.current_agent_index: int = 0
        self.is_random_turn: bool = False
        self.is_turn_aware: bool = False
        self.turn_queue: List[int] = []
        self.model_info_enabled: bool = False
        self.rag_enabled: bool = False
        self.search_model: str = None

        self.summary_model: str = "gpt-4o-mini"
        self.summary_trigger: int = 100
        self.summary_prompt: str = ""
        self.prompt_mode: bool = False

        self._load_from_db()

    def _save_to_db(self):
        db = SessionLocal()
        try:
            session_record = db.query(SessionModel).filter(SessionModel.id == self.session_id).first()
            if not session_record:
                session_record = SessionModel(id=self.session_id)
                db.add(session_record)

            session_record.topic = self.topic
            session_record.max_rounds = self.max_rounds
            session_record.current_round = self.current_round
            session_record.state = self.state
            session_record.is_random_turn = self.is_random_turn
            session_record.is_turn_aware = self.is_turn_aware
            session_record.model_info_enabled = self.model_info_enabled
            session_record.rag_enabled = self.rag_enabled
            session_record.search_model = self.search_model
            session_record.summary_model = self.summary_model
            session_record.summary_trigger = self.summary_trigger
            session_record.summary_prompt = self.summary_prompt
            session_record.prompt_mode = self.prompt_mode

            db.query(AgentModel).filter(AgentModel.session_id == self.session_id).delete()
            for agent in self.agents:
                db_agent = AgentModel(
                    session_id=self.session_id,
                    name=agent.name,
                    model=agent.model,
                    persona=agent.persona,
                    is_muted=agent.is_muted,
                    api_base_url=None,
                    api_key=None,
                )
                db.add(db_agent)

            runtime = (
                db.query(SessionMetaModel)
                .filter(SessionMetaModel.session_id == self.session_id, SessionMetaModel.key == "runtime")
                .first()
            )
            payload = {"current_agent_index": self.current_agent_index, "turn_queue": self.turn_queue}
            if runtime:
                runtime.value_json = payload
            else:
                db.add(SessionMetaModel(session_id=self.session_id, key="runtime", value_json=payload))

            db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    def _load_from_db(self):
        db = SessionLocal()
        try:
            session_record = db.query(SessionModel).filter(SessionModel.id == self.session_id).first()
            if session_record:
                self.topic = session_record.topic
                self.max_rounds = session_record.max_rounds
                self.current_round = session_record.current_round
                self.state = session_record.state
                self.is_random_turn = session_record.is_random_turn
                self.is_turn_aware = session_record.is_turn_aware
                self.model_info_enabled = session_record.model_info_enabled
                self.rag_enabled = session_record.rag_enabled
                self.search_model = session_record.search_model
                self.summary_model = session_record.summary_model
                self.summary_trigger = session_record.summary_trigger
                self.summary_prompt = session_record.summary_prompt
                self.prompt_mode = session_record.prompt_mode

                self.agents = []
                for db_agent in session_record.agents:
                    agent_client = self.client
                    if db_agent.api_key or db_agent.api_base_url:
                        merged_api_key = db_agent.api_key if db_agent.api_key else getattr(self.client.client, "api_key", "")
                        merged_base_url = (
                            db_agent.api_base_url if db_agent.api_base_url else getattr(self.client.client, "base_url", "")
                        )
                        if hasattr(merged_base_url, "__str__"):
                            merged_base_url = str(merged_base_url)
                        agent_client = DynamicClient(merged_api_key, merged_base_url)

                    agent = Agent(
                        db_agent.name,
                        db_agent.model,
                        db_agent.persona,
                        agent_client,
                        custom_api_key=db_agent.api_key,
                        custom_base_url=db_agent.api_base_url,
                    )
                    agent.set_muted(db_agent.is_muted)
                    agent.set_topic(self.topic)
                    agent.set_search_model_enabled(self.rag_enabled)
                    self.agents.append(agent)

                self.history = []
                for db_msg in session_record.messages:
                    self.history.append(
                        {
                            "speaker": db_msg.speaker,
                            "model": db_msg.model,
                            "content": db_msg.content,
                            "visible_to": db_msg.visible_to,
                            "metadata": db_msg.metadata_json,
                        }
                    )

                runtime = (
                    db.query(SessionMetaModel)
                    .filter(SessionMetaModel.session_id == self.session_id, SessionMetaModel.key == "runtime")
                    .first()
                )
                if runtime and isinstance(runtime.value_json, dict):
                    idx = runtime.value_json.get("current_agent_index")
                    q = runtime.value_json.get("turn_queue")
                    if isinstance(idx, int):
                        self.current_agent_index = idx
                    if isinstance(q, list) and all(isinstance(x, int) for x in q):
                        self.turn_queue = q
        finally:
            db.close()

    def initialize_debate(self, topic: str, rounds: int, agents_config: List[Dict], **kwargs):
        self.topic = topic
        self.max_rounds = rounds
        self.current_round = 1
        self.state = "ONGOING"
        self.history = []
        self.stop_requested = False
        self.agents = []
        self.current_agent_index = 0
        self.is_random_turn = kwargs.get("is_random_turn", False)
        self.is_turn_aware = kwargs.get("is_turn_aware", True)
        self.model_info_enabled = kwargs.get("model_info_enabled", False)
        self.rag_enabled = kwargs.get("rag_enabled", False)
        self.search_model = kwargs.get("search_model", "gpt-4o-mini")

        self.summary_model = kwargs.get("summary_model", "gpt-4o-mini")
        self.summary_trigger = int(kwargs.get("summary_trigger", 100) or 100)
        self.summary_prompt = kwargs.get("summary_prompt", "")
        self.prompt_mode = kwargs.get("prompt_mode", False)

        self.turn_queue = []

        db = SessionLocal()
        try:
            db.query(MessageModel).filter(MessageModel.session_id == self.session_id).delete()
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        for config in agents_config:
            agent_client = self.client
            if config.get("api_key") or config.get("api_base_url"):
                merged_api_key = config.get("api_key") if config.get("api_key") else getattr(self.client.client, "api_key", "")
                merged_base_url = (
                    config.get("api_base_url") if config.get("api_base_url") else getattr(self.client.client, "base_url", "")
                )

                if hasattr(merged_base_url, "__str__"):
                    merged_base_url = str(merged_base_url)

                agent_client = DynamicClient(merged_api_key, merged_base_url)

            agent = Agent(
                config["name"],
                config["model"],
                config["persona"],
                agent_client,
                custom_api_key=config.get("api_key"),
                custom_base_url=config.get("api_base_url"),
            )
            agent.set_muted(config.get("is_muted", False))
            agent.set_topic(topic)
            agent.set_search_model_enabled(self.rag_enabled)
            self.agents.append(agent)

        self._save_to_db()
        return {"status": "initialized", "topic": topic, "agents": len(self.agents)}

    def _check_and_summarize(self):
        if not self.summary_model:
            return
        if self.summary_trigger <= 0:
            return
        if len(self.history) < self.summary_trigger:
            return

        stay_messages = self.history[-2:] if len(self.history) >= 2 else self.history[:]
        history_text = []
        for i, msg in enumerate(self.history[:-2] if len(self.history) >= 2 else self.history):
            content_no_think = re.sub(
                r"<SEARCH>.*?</SEARCH>",
                "",
                re.sub(r"<think>.*?</think>", "", msg["content"], flags=re.DOTALL),
                flags=re.DOTALL,
            ).strip()
            history_text.append(f"[{i+1}] {msg['speaker']}({msg['model']}): {content_no_think}")

        default_prompt = (
            "你是一个对话总结助手。请将以下多智能体辩论/对话总结成结构化要点，保留关键事实、观点分歧、结论趋势。"
            "用中文输出，条理清晰，避免复述无关细节。"
        )
        prompt = self.summary_prompt.strip() if self.prompt_mode and self.summary_prompt.strip() else default_prompt

        try:
            response = self.client.chat_completion(
                messages=[{"role": "user", "content": f"{prompt}\n\n对话内容：\n" + "\n".join(history_text)}],
                model=self.summary_model,
                stream=False,
            )
            summary_result = response.choices[0].message.content or ""

            db = SessionLocal()
            try:
                db.query(MessageModel).filter(MessageModel.session_id == self.session_id).delete()
                db.commit()
            finally:
                db.close()

            self.history = [
                {
                    "speaker": "System",
                    "model": self.summary_model,
                    "content": f"【自动摘要】历史对话总结：\n{summary_result}",
                    "visible_to": ["ALL"],
                    "metadata": {"type": "summary"},
                }
            ] + stay_messages

            for msg in self.history:
                self._add_message_to_db(msg["speaker"], msg["model"], msg["content"], msg.get("visible_to", ["ALL"]), msg.get("metadata"))

        except Exception:
            return

    def _add_message_to_db(self, speaker, model, content, visible_to=["ALL"], metadata=None):
        db = SessionLocal()
        try:
            db_msg = MessageModel(
                session_id=self.session_id,
                speaker=speaker,
                model=model,
                content=content,
                visible_to=visible_to,
                metadata_json=metadata,
            )
            db.add(db_msg)
            db.commit()
        finally:
            db.close()

    def sync_agent_memories(self):
        for agent in self.agents:
            agent.memory = []
            for msg in self.history:
                speaker = msg["speaker"]
                content = msg["content"]
                visible_to = msg.get("visible_to", ["ALL"])

                if speaker == "System":
                    continue

                if "ALL" not in visible_to and agent.name not in visible_to and speaker != agent.name:
                    continue

                if speaker != agent.name:
                    content = re.sub(
                        r"<SEARCH>.*?</SEARCH>",
                        "",
                        re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL),
                        flags=re.DOTALL,
                    ).strip()

                if isinstance(content, str) and content.startswith("JSON_MSG:"):
                    try:
                        content_list = json.loads(content[9:])
                        final_content = content_list
                    except Exception:
                        final_content = content
                else:
                    final_content = content

                if speaker == agent.name:
                    role = "assistant"
                else:
                    role = "user"
                    if "ALL" not in visible_to:
                        if isinstance(final_content, str):
                            final_content = f"【私聊】{speaker} 悄悄对你说：{final_content}"

                agent.receive_message(role, final_content)

    def inject_message(self, content: str):
        user_msg = {
            "speaker": "User",
            "model": "Human",
            "content": content,
            "visible_to": ["ALL"],
            "history_index": len(self.history),
        }
        self.history.append(user_msg)
        self._add_message_to_db("User", "Human", content, ["ALL"])
        self.sync_agent_memories()
        target_agents = []
        for agent in self.agents:
            if f"@{agent.name}" in content:
                target_agents.append(agent.name)

        return {"message": user_msg, "trigger_reply": target_agents if target_agents else None}

    def force_turn(self, agent_name: str):
        self.stop_requested = False
        original_agent_index = self.current_agent_index
        original_round = self.current_round
        original_turn_queue = list(self.turn_queue) if isinstance(getattr(self, "turn_queue", None), list) else []
        original_state = self.state

        target_agent = next((a for a in self.agents if a.name == agent_name), None)
        if not target_agent:
            yield json.dumps({"status": "error", "message": f"未找到智能体 {agent_name}"}) + "\n"
            return

        self.sync_agent_memories()

        prompt = "用户向你提问/艾特了你。请根据对话历史回答用户的问题。"

        start_time = time.time()
        start_time_str = datetime.now().strftime("%H:%M:%S")

        yield json.dumps(
            {
                "type": "ongoing",
                "status": "ongoing",
                "state": "SPEAKING",
                "speaker": target_agent.name,
                "model": target_agent.model,
                "round": self.current_round,
                "history_index": len(self.history),
            }
        ) + "\n"

        raw_full_content = ""
        full_content = ""
        usage = {}
        thinking_end_time = None
        pending = ""
        in_search = False

        try:
            response_generator = target_agent.speak(prompt)
            for chunk in response_generator:
                if self.stop_requested:
                    break

                if chunk["type"] == "content":
                    c = chunk["content"]
                    raw_full_content += c
                    if "</think>" in c:
                        thinking_end_time = time.time()
                    pending += c
                    visible_out = ""
                    while True:
                        if not in_search:
                            start = pending.find("<SEARCH>")
                            if start == -1:
                                if len(pending) <= 7:
                                    break
                                safe = pending[:-7]
                                visible_out += safe
                                pending = pending[-7:]
                                break
                            visible_out += pending[:start]
                            pending = pending[start + 8 :]
                            in_search = True
                        else:
                            end = pending.find("</SEARCH>")
                            if end == -1:
                                pending = pending[-8:] if len(pending) > 8 else pending
                                break
                            pending = pending[end + 9 :]
                            in_search = False
                    if visible_out:
                        full_content += visible_out
                        yield json.dumps({"type": "chunk", "content": visible_out}) + "\n"
                elif chunk["type"] == "usage":
                    usage = chunk["usage"]
                elif chunk["type"] == "error":
                    yield json.dumps({"type": "error", "message": chunk["message"]}) + "\n"
                    return

            if pending and not in_search:
                full_content += pending
                yield json.dumps({"type": "chunk", "content": pending}) + "\n"
                pending = ""

            search_match = re.search(r"<SEARCH>(.*?)</SEARCH>", raw_full_content, re.DOTALL)
            if search_match and self.rag_enabled:
                query = search_match.group(1).strip()
                yield json.dumps({"type": "rag", "agent": target_agent.name, "query": query, "model": self.search_model}) + "\n"
                search_result = self._perform_rag_search(query, target_agent.name)
                target_agent.memory.append({"role": "user", "content": f"【系统检索结果】:\n{search_result}"})
                for chunk in target_agent.speak("请根据检索结果继续回答用户的问题。"):
                    if self.stop_requested:
                        break
                    if chunk["type"] == "content":
                        c2 = chunk["content"]
                        raw_full_content += c2
                        pending += c2
                        visible_out2 = ""
                        while True:
                            if not in_search:
                                start = pending.find("<SEARCH>")
                                if start == -1:
                                    if len(pending) <= 7:
                                        break
                                    safe = pending[:-7]
                                    visible_out2 += safe
                                    pending = pending[-7:]
                                    break
                                visible_out2 += pending[:start]
                                pending = pending[start + 8 :]
                                in_search = True
                            else:
                                end = pending.find("</SEARCH>")
                                if end == -1:
                                    pending = pending[-8:] if len(pending) > 8 else pending
                                    break
                                pending = pending[end + 9 :]
                                in_search = False
                        if visible_out2:
                            full_content += visible_out2
                            yield json.dumps({"type": "chunk", "content": visible_out2}) + "\n"
                if pending and not in_search:
                    full_content += pending
                    yield json.dumps({"type": "chunk", "content": pending}) + "\n"
                    pending = ""
        finally:
            self.current_agent_index = original_agent_index
            self.current_round = original_round
            self.turn_queue = original_turn_queue
            self.state = original_state
            end_time = time.time()
            metadata = {
                "start_time_str": start_time_str,
                "thinking_duration": thinking_end_time - start_time if thinking_end_time else None,
                "total_duration": end_time - start_time,
                "total_tokens": usage.get("total_tokens", "N/A"),
                "model": target_agent.model,
            }

            self.history.append(
                {
                    "speaker": target_agent.name,
                    "model": target_agent.model,
                    "content": full_content,
                    "metadata": metadata,
                    "visible_to": ["ALL"],
                }
            )
            self._add_message_to_db(target_agent.name, target_agent.model, full_content, ["ALL"], metadata)
            self._save_to_db()
            yield json.dumps({"type": "done", "metadata": metadata}) + "\n"

    def _perform_rag_search(self, query: str, agent_name: str) -> str:
        try:
            prompt = (
                "请提取以下搜索请求中的核心关键词（2-3个即可，用空格分隔）。\n"
                f"搜索请求：{query}\n"
                "只输出关键词。"
            )
            response = self.client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                model=self.search_model or "gpt-4o-mini",
                stream=False,
            )
            keywords_str = response.choices[0].message.content or ""
            keywords = [k.strip() for k in keywords_str.split() if k.strip()]

            results = []
            for i, msg in enumerate(self.history):
                content_no_think = re.sub(
                    r"<SEARCH>.*?</SEARCH>",
                    "",
                    re.sub(r"<think>.*?</think>", "", msg["content"], flags=re.DOTALL),
                    flags=re.DOTALL,
                ).strip()
                if any(kw.lower() in content_no_think.lower() for kw in keywords):
                    results.append(f"[历史 #{i+1}] {msg['speaker']}: {content_no_think[:200]}...")

            return "\n\n".join(results[:5]) if results else "没有找到相关信息。"
        except Exception as e:
            return f"搜索失败: {e}"

    def next_turn(self):
        self.stop_requested = False
        try:
            if self.state == "FINISHED" or not self.agents:
                yield json.dumps({"status": "finished", "message": "对局已结束或尚未初始化智能体"}) + "\n"
                return

            import random

            if self.is_random_turn:
                if not self.turn_queue:
                    self.turn_queue = list(range(len(self.agents)))
                    random.shuffle(self.turn_queue)
                if not self.turn_queue:
                    yield json.dumps({"status": "error", "message": "无可用智能体发言"}) + "\n"
                    return
                self.current_agent_index = self.turn_queue.pop(0)

            current_agent = self.agents[self.current_agent_index]
            if current_agent.is_muted:
                self.current_agent_index = (self.current_agent_index + 1) % len(self.agents)
                yield from self.next_turn()
                return

            self.sync_agent_memories()

            prompt = "现在轮到你发言了。"
            if self.is_turn_aware:
                prompt = f"【当前轮次: {self.current_round}/{self.max_rounds}】\n{prompt}"

            start_time = time.time()
            start_time_str = datetime.now().strftime("%H:%M:%S")

            yield json.dumps(
                {
                    "type": "ongoing",
                    "status": "ongoing",
                    "state": "SPEAKING",
                    "speaker": current_agent.name,
                    "model": current_agent.model,
                    "round": self.current_round,
                    "history_index": len(self.history),
                }
            ) + "\n"

            raw_full_content = ""
            full_content = ""
            usage = {}
            thinking_end_time = None
            pending = ""
            in_search = False

            response_generator = current_agent.speak(prompt)
            for chunk in response_generator:
                if self.stop_requested:
                    break

                if chunk["type"] == "content":
                    c = chunk["content"]
                    raw_full_content += c
                    if "</think>" in c:
                        thinking_end_time = time.time()
                    pending += c
                    visible_out = ""
                    while True:
                        if not in_search:
                            start = pending.find("<SEARCH>")
                            if start == -1:
                                if len(pending) <= 7:
                                    break
                                safe = pending[:-7]
                                visible_out += safe
                                pending = pending[-7:]
                                break
                            visible_out += pending[:start]
                            pending = pending[start + 8 :]
                            in_search = True
                        else:
                            end = pending.find("</SEARCH>")
                            if end == -1:
                                pending = pending[-8:] if len(pending) > 8 else pending
                                break
                            pending = pending[end + 9 :]
                            in_search = False
                    if visible_out:
                        full_content += visible_out
                        yield json.dumps({"type": "chunk", "content": visible_out}) + "\n"
                elif chunk["type"] == "usage":
                    usage = chunk["usage"]
                elif chunk["type"] == "error":
                    yield json.dumps({"type": "error", "message": chunk["message"]}) + "\n"
                    return

            if pending and not in_search:
                full_content += pending
                yield json.dumps({"type": "chunk", "content": pending}) + "\n"
                pending = ""

            if not full_content and not self.stop_requested:
                yield json.dumps({"type": "error", "message": f"智能体 {current_agent.name} 未生成任何内容，请检查模型配置或 API Key。"}) + "\n"

            search_match = re.search(r"<SEARCH>(.*?)</SEARCH>", raw_full_content, re.DOTALL)
            if search_match and self.rag_enabled:
                query = search_match.group(1).strip()
                yield json.dumps({"type": "rag", "agent": current_agent.name, "query": query, "model": self.search_model}) + "\n"
                search_result = self._perform_rag_search(query, current_agent.name)
                current_agent.memory.append({"role": "user", "content": f"【系统检索结果】:\n{search_result}"})
                for chunk in current_agent.speak("请根据检索结果继续发言。"):
                    if self.stop_requested:
                        break
                    if chunk["type"] == "content":
                        c2 = chunk["content"]
                        raw_full_content += c2
                        pending += c2
                        visible_out2 = ""
                        while True:
                            if not in_search:
                                start = pending.find("<SEARCH>")
                                if start == -1:
                                    if len(pending) <= 7:
                                        break
                                    safe = pending[:-7]
                                    visible_out2 += safe
                                    pending = pending[-7:]
                                    break
                                visible_out2 += pending[:start]
                                pending = pending[start + 8 :]
                                in_search = True
                            else:
                                end = pending.find("</SEARCH>")
                                if end == -1:
                                    pending = pending[-8:] if len(pending) > 8 else pending
                                    break
                                pending = pending[end + 9 :]
                                in_search = False
                        if visible_out2:
                            full_content += visible_out2
                            yield json.dumps({"type": "chunk", "content": visible_out2}) + "\n"
                if pending and not in_search:
                    full_content += pending
                    yield json.dumps({"type": "chunk", "content": pending}) + "\n"
                    pending = ""

        except Exception as e:
            error_msg = f"智能体发言出错: {str(e)}"
            yield json.dumps({"type": "error", "message": error_msg}) + "\n"
            return

        finally:
            if "full_content" in locals() and full_content:
                end_time = time.time()
                metadata = {
                    "start_time_str": start_time_str,
                    "thinking_duration": thinking_end_time - start_time if thinking_end_time else None,
                    "total_duration": end_time - start_time,
                    "total_tokens": usage.get("total_tokens", "N/A"),
                    "model": current_agent.model,
                }

                self.history.append(
                    {
                        "speaker": current_agent.name,
                        "model": current_agent.model,
                        "content": full_content,
                        "metadata": metadata,
                        "visible_to": ["ALL"],
                    }
                )
                self._add_message_to_db(current_agent.name, current_agent.model, full_content, ["ALL"], metadata)
                self._check_and_summarize()

                if not self.is_random_turn:
                    self.current_agent_index = (self.current_agent_index + 1) % len(self.agents)
                    if self.current_agent_index == 0:
                        self.current_round += 1
                else:
                    self.current_round = len(self.history) // max(len(self.agents), 1) + 1

                self._save_to_db()
                yield json.dumps({"type": "done", "metadata": metadata}) + "\n"

            if self.current_round > self.max_rounds:
                self.state = "FINISHED"
                yield json.dumps({"status": "finished", "message": "已达到最大轮次"}) + "\n"

    def stop(self):
        self.stop_requested = True

    def update_message(self, index: int, new_content: str):
        if 0 <= index < len(self.history):
            self.history[index]["content"] = new_content
            db = SessionLocal()
            try:
                msg_to_update = (
                    db.query(MessageModel)
                    .filter(MessageModel.session_id == self.session_id)
                    .order_by(MessageModel.id)
                    .offset(index)
                    .first()
                )
                if msg_to_update:
                    msg_to_update.content = new_content
                    db.commit()
                    return True
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        return False

    def delete_message(self, index: int):
        if 0 <= index < len(self.history):
            del self.history[index]
            db = SessionLocal()
            try:
                msg_to_delete = (
                    db.query(MessageModel)
                    .filter(MessageModel.session_id == self.session_id)
                    .order_by(MessageModel.id)
                    .offset(index)
                    .first()
                )
                if msg_to_delete:
                    db.delete(msg_to_delete)
                    db.commit()
                    return True
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        return False


class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, DebateSession] = {}

    def get_session(self, session_id: str, api_key: str = None, base_url: str = None) -> DebateSession:
        if session_id not in self.sessions:
            self.sessions[session_id] = DebateSession(session_id, api_key, base_url)
        else:
            if api_key and base_url:
                self.sessions[session_id].client = DynamicClient(api_key, base_url)
        return self.sessions[session_id]

    def reset_session(self, session_id: str):
        if session_id in self.sessions:
            del self.sessions[session_id]


session_manager = SessionManager()
