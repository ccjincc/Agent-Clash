import json
import uuid
from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from app.core.game_manager import session_manager
from app.core.client import DynamicClient
from app.db.database import SessionLocal, SessionModel, MessageModel

router = APIRouter()


class InitRequest(BaseModel):
    topic: str
    rounds: int
    agents: List[Dict[str, Any]]
    is_random_turn: bool = False
    is_turn_aware: bool = True
    rag_enabled: bool = False
    search_model: str = "gpt-4o-mini"
    summary_model: str = "gpt-4o-mini"
    summary_prompt: str = ""
    summary_trigger: int = 100
    prompt_mode: bool = False
    model_info_enabled: bool = False
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ModelsRequest(BaseModel):
    api_key: str
    base_url: str


class SendRequest(BaseModel):
    content: str


class ReplyRequest(BaseModel):
    agent: str


class EditRequest(BaseModel):
    index: int
    content: str


class DeleteRequest(BaseModel):
    index: int


class DeleteSessionRequest(BaseModel):
    id: str


@router.post("/api/models")
async def get_models(req: ModelsRequest):
    client = DynamicClient(req.api_key, req.base_url)
    try:
        models = client.list_models()
        if models:
            return {"status": "success", "models": models}
        return {"status": "error", "message": "模型列表为空（可能是权限不足或接口不兼容）"}
    except Exception as e:
        msg = str(e) or "Failed to fetch models"
        msg = msg.replace(req.api_key, "***") if req.api_key else msg
        return {"status": "error", "message": msg[:300]}


@router.post("/api/init")
async def init_game(req: InitRequest, session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session_manager.reset_session(session_id)
    session = session_manager.get_session(session_id, req.api_key, req.base_url)

    result = session.initialize_debate(
        topic=req.topic,
        rounds=req.rounds,
        agents_config=req.agents,
        is_random_turn=req.is_random_turn,
        is_turn_aware=req.is_turn_aware,
        rag_enabled=req.rag_enabled,
        search_model=req.search_model,
        summary_model=req.summary_model,
        summary_prompt=req.summary_prompt,
        summary_trigger=req.summary_trigger,
        prompt_mode=req.prompt_mode,
        model_info_enabled=req.model_info_enabled,
    )
    return result


@router.post("/api/next")
async def next_turn(session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)
    return StreamingResponse(session.next_turn(), media_type="text/event-stream")


@router.post("/api/reply")
async def reply_turn(req: ReplyRequest, session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)
    return StreamingResponse(session.force_turn(req.agent), media_type="text/event-stream")


@router.post("/api/send")
async def send_message(req: SendRequest, session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)
    result = session.inject_message(req.content)
    return {"status": "success", **result}


@router.post("/api/edit")
async def edit_message(req: EditRequest, session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)

    original_msg = session.history[req.index]["content"]
    if "</think>" in original_msg:
        think_part = original_msg.split("</think>")[0] + "</think>\n\n"
        new_full_content = think_part + req.content
    else:
        new_full_content = req.content

    if session.update_message(req.index, new_full_content):
        return {"status": "success"}
    return {"status": "error", "message": "Index out of range"}


@router.post("/api/delete")
async def delete_message(req: DeleteRequest, session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)
    if session.delete_message(req.index):
        return {"status": "success"}
    return {"status": "error", "message": "Index out of range"}


@router.post("/api/stop")
async def stop_generation(session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)
    session.stop()
    return {"status": "stopped"}


@router.get("/api/state")
async def get_state(session_id: str = Header(None, alias="session-id")):
    if not session_id:
        return {"status": "error", "message": "Missing session-id header"}

    session = session_manager.get_session(session_id)
    return {
        "round": session.current_round,
        "max_rounds": session.max_rounds,
        "state": session.state,
        "topic": session.topic,
        "is_random_turn": session.is_random_turn,
        "is_turn_aware": session.is_turn_aware,
        "rag_enabled": session.rag_enabled,
        "search_model": session.search_model,
        "summary_model": session.summary_model,
        "summary_trigger": session.summary_trigger,
        "summary_prompt": session.summary_prompt,
        "prompt_mode": session.prompt_mode,
        "model_info_enabled": session.model_info_enabled,
        "agents": [{"name": a.name, "model": a.model, "persona": a.persona, "is_muted": a.is_muted} for a in session.agents],
        "history": session.history,
    }


@router.get("/api/sessions")
async def list_sessions():
    db = SessionLocal()
    try:
        sessions = db.query(SessionModel).all()
        items: List[Dict[str, Any]] = []
        for s in sessions:
            last_msg = (
                db.query(MessageModel)
                .filter(MessageModel.session_id == s.id)
                .order_by(MessageModel.id.desc())
                .first()
            )
            first_user = (
                db.query(MessageModel)
                .filter(MessageModel.session_id == s.id, MessageModel.speaker == "User")
                .order_by(MessageModel.id.asc())
                .first()
            )
            title = (s.topic or "").strip() or ((first_user.content if first_user else "") or "").strip()
            title = title.replace("\n", " ").strip()
            if not title:
                title = s.id[:8]
            if len(title) > 24:
                title = title[:24] + "…"
            items.append({"id": s.id, "title": title, "last_message_id": last_msg.id if last_msg else 0})
        items.sort(key=lambda x: x.get("last_message_id", 0), reverse=True)
        return {"sessions": items}
    finally:
        db.close()


@router.post("/api/sessions/new")
async def new_session():
    session_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(SessionModel(id=session_id))
        db.commit()
    finally:
        db.close()
    return {"id": session_id}


@router.post("/api/sessions/delete")
async def delete_session(req: DeleteSessionRequest):
    session_manager.reset_session(req.id)
    db = SessionLocal()
    try:
        db.query(SessionModel).filter(SessionModel.id == req.id).delete()
        db.commit()
    finally:
        db.close()
    return {"status": "success"}
