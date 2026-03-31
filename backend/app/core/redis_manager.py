import json
import uuid
import time
from typing import Dict, List, Optional

# V2: Temporary In-Memory Session Manager
# We will use this until Redis is properly installed on the local Windows machine
# In production, this will be swapped out for actual Redis commands

class InMemorySessionManager:
    def __init__(self, ttl: int = 86400):
        self.ttl = ttl
        self._store = {}
        self._locks = {}

    def create_session(self) -> str:
        session_id = str(uuid.uuid4())
        initial_state = {
            "state": "IDLE",
            "current_round": 0,
            "max_rounds": 10,
            "topic": "",
            "agents": [],
            "history": [],
            "created_at": time.time()
        }
        self.save_session(session_id, initial_state)
        return session_id

    def get_session(self, session_id: str) -> Optional[Dict]:
        data = self._store.get(f"session:{session_id}")
        if data:
            return json.loads(data)
        return None

    def save_session(self, session_id: str, state: Dict):
        self._store[f"session:{session_id}"] = json.dumps(state)

    def append_message(self, session_id: str, message: Dict):
        state = self.get_session(session_id)
        if state:
            state["history"].append(message)
            self.save_session(session_id, state)

    def update_state(self, session_id: str, updates: Dict):
        state = self.get_session(session_id)
        if state:
            state.update(updates)
            self.save_session(session_id, state)

    def lock_session(self, session_id: str, timeout: int = 30) -> bool:
        lock_key = f"lock:{session_id}"
        if lock_key in self._locks:
            return False
        self._locks[lock_key] = time.time() + timeout
        return True

    def unlock_session(self, session_id: str):
        lock_key = f"lock:{session_id}"
        if lock_key in self._locks:
            del self._locks[lock_key]

session_manager = InMemorySessionManager()
