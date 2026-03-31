from sqlalchemy import create_engine, Column, Integer, String, Boolean, JSON, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
import os

DB_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(DB_DIR, exist_ok=True)
SQLALCHEMY_DATABASE_URL = f"sqlite:///{os.path.join(DB_DIR, 'arena.db')}"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class SessionModel(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, index=True)
    topic = Column(String, default="")
    max_rounds = Column(Integer, default=10)
    current_round = Column(Integer, default=0)
    state = Column(String, default="IDLE")
    is_random_turn = Column(Boolean, default=False)
    is_turn_aware = Column(Boolean, default=False)
    model_info_enabled = Column(Boolean, default=False)
    rag_enabled = Column(Boolean, default=False)
    search_model = Column(String, nullable=True)
    summary_model = Column(String, default="gpt-4o-mini")
    summary_trigger = Column(Integer, default=100)
    summary_prompt = Column(String, default="")
    prompt_mode = Column(Boolean, default=False)

    agents = relationship("AgentModel", back_populates="session", cascade="all, delete-orphan")
    messages = relationship("MessageModel", back_populates="session", cascade="all, delete-orphan")
    metas = relationship("SessionMetaModel", back_populates="session", cascade="all, delete-orphan")


class AgentModel(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("sessions.id"))
    name = Column(String)
    model = Column(String)
    persona = Column(String)
    is_muted = Column(Boolean, default=False)
    api_base_url = Column(String, nullable=True)
    api_key = Column(String, nullable=True)

    session = relationship("SessionModel", back_populates="agents")


class MessageModel(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("sessions.id"))
    speaker = Column(String)
    model = Column(String)
    content = Column(String)
    visible_to = Column(JSON)
    metadata_json = Column(JSON, nullable=True)

    session = relationship("SessionModel", back_populates="messages")


class SessionMetaModel(Base):
    __tablename__ = "session_meta"

    session_id = Column(String, ForeignKey("sessions.id"), primary_key=True)
    key = Column(String, primary_key=True)
    value_json = Column(JSON, nullable=True)

    session = relationship("SessionModel", back_populates="metas")


Base.metadata.create_all(bind=engine)
