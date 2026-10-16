"""
OpenHands-like AI Assistant Backend
FastAPI server with OpenHands SDK integration
"""

import os
import json
import uuid
import asyncio
import threading
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sse_starlette.sse import EventSourceResponse

# OpenHands SDK imports
from openhands.sdk import LLM, Agent, Conversation as OHConversation
from openhands.sdk.event import (
    ActionEvent,
    AgentErrorEvent,
    MessageEvent,
    ObservationEvent,
    PauseEvent,
)

# Load environment variables from .env file
load_dotenv()

# Database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./conversations.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# Database Models
class ConversationDB(Base):
    __tablename__ = "conversations"
    
    id = Column(String, primary_key=True, index=True)
    title = Column(String, default="New Conversation")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    status = Column(String, default="idle")  # idle, running, paused, completed
    workspace_path = Column(String, nullable=True)


class MessageDB(Base):
    __tablename__ = "messages"
    
    id = Column(String, primary_key=True, index=True)
    conversation_id = Column(String, index=True)
    role = Column(String)  # user, assistant, system, tool
    content = Column(Text)
    tool_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


# Pydantic Models
class MessageModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str
    content: str
    tool_name: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConversationModel(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    status: str
    messages: List[MessageModel] = []
    
    class Config:
        from_attributes = True


class ConversationCreate(BaseModel):
    title: Optional[str] = None


class MessageCreate(BaseModel):
    content: str


# In-memory conversation state (using OpenHands SDK)
active_conversations: Dict[str, Dict[str, Any]] = {}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_llm() -> LLM:
    """Initialize LLM with environment variables."""
    kwargs: Dict[str, Any] = {"model": os.getenv("LLM_MODEL", "gpt-4o")}
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    if api_key:
        kwargs["api_key"] = api_key
    base_url = os.getenv("LLM_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url
    return LLM(**kwargs)


def get_agent(llm: LLM) -> Agent:
    """Create agent with default tools."""
    return Agent(llm=llm)


def event_to_payload(event: Any) -> Optional[Dict[str, str]]:
    """Convert an SDK event into a browser-friendly chunk.

    Returns ``None`` for events that carry nothing worth showing.
    """
    # The user's own message is re-emitted on the event stream; the frontend
    # already renders it locally, so skip it to avoid a duplicate bubble.
    if getattr(event, "source", None) == "user":
        return None
    if isinstance(event, ActionEvent):
        thought = (event.thought or "").strip()
        tool = event.tool_name or "tool"
        if thought:
            return {"kind": "thought", "content": thought, "tool": tool}
        return {"kind": "action", "content": f"Calling {tool}...", "tool": tool}
    if isinstance(event, ObservationEvent):
        text = str(event.observation) if event.observation is not None else ""
        if not text:
            return None
        return {"kind": "observation", "content": text, "tool": event.tool_name or "tool"}
    if isinstance(event, MessageEvent):
        text = message_event_text(event)
        if not text:
            return None
        return {"kind": "message", "content": text, "tool": ""}
    if isinstance(event, AgentErrorEvent):
        return {"kind": "error", "content": event.error or "Agent error", "tool": event.tool_name or ""}
    if isinstance(event, PauseEvent):
        return {"kind": "paused", "content": "Conversation paused.", "tool": ""}
    return None


def message_event_text(event: MessageEvent) -> str:
    """Pull plain text out of a MessageEvent's litellm message."""
    content = getattr(event.llm_message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
            elif isinstance(block, dict) and block.get("text"):
                parts.append(block["text"])
        return "\n".join(parts)
    return ""


# Lifespan for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting OpenHands-like AI Assistant...")
    yield
    print("👋 Shutting down...")


# FastAPI App
app = FastAPI(
    title="OpenHands-like AI Assistant",
    description="AI-powered development assistant similar to OpenHands Cloud",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Routes
@app.get("/")
async def root():
    return {"message": "OpenHands-like AI Assistant API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


# Conversation Routes
@app.post("/api/conversations", response_model=ConversationModel)
async def create_conversation(conversation_data: ConversationCreate, db: Session = Depends(get_db)):
    """Create a new conversation"""
    conv_id = str(uuid.uuid4())
    title = conversation_data.title or f"Conversation {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    
    # Create database record
    db_conv = ConversationDB(
        id=conv_id,
        title=title,
        status="idle"
    )
    db.add(db_conv)
    db.commit()
    db.refresh(db_conv)
    
    # Workspace is created eagerly; the SDK conversation is built on first
    # message so that creating a chat never needs model credentials.
    workspace_path = f"./workspaces/{conv_id}"
    os.makedirs(workspace_path, exist_ok=True)

    return ConversationModel(
        id=conv_id,
        title=title,
        created_at=db_conv.created_at,
        updated_at=db_conv.updated_at,
        status="idle",
        messages=[]
    )


@app.get("/api/conversations", response_model=List[ConversationModel])
async def list_conversations(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """List all conversations"""
    conversations = db.query(ConversationDB).order_by(
        ConversationDB.updated_at.desc()
    ).offset(skip).limit(limit).all()
    
    return [
        ConversationModel(
            id=c.id,
            title=c.title,
            created_at=c.created_at,
            updated_at=c.updated_at,
            status=c.status,
            messages=[]
        )
        for c in conversations
    ]


@app.get("/api/conversations/{conversation_id}", response_model=ConversationModel)
async def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Get a specific conversation with messages"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    messages = db.query(MessageDB).filter(
        MessageDB.conversation_id == conversation_id
    ).order_by(MessageDB.created_at).all()
    
    return ConversationModel(
        id=db_conv.id,
        title=db_conv.title,
        created_at=db_conv.created_at,
        updated_at=db_conv.updated_at,
        status=db_conv.status,
        messages=[
            MessageModel(
                id=m.id,
                role=m.role,
                content=m.content,
                tool_name=m.tool_name,
                created_at=m.created_at
            )
            for m in messages
        ]
    )


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Delete a conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Remove from active conversations and release SDK resources
    entry = active_conversations.pop(conversation_id, None)
    if entry is not None:
        try:
            entry["conversation"].close()
        except Exception:
            pass
    
    # Delete messages
    db.query(MessageDB).filter(MessageDB.conversation_id == conversation_id).delete()
    db.delete(db_conv)
    db.commit()
    
    return {"message": "Conversation deleted"}


def build_conversation(conversation_id: str, workspace_path: str) -> Dict[str, Any]:
    """Create an SDK conversation whose event sink can be swapped per request.

    The SDK binds its callbacks once, when the conversation is constructed, but
    each HTTP request streams into its own queue. Routing through a mutable
    ``entry["sink"]`` lets later requests receive events too; passing a
    request-scoped callback here would send them to the first request's queue.
    """
    llm = get_llm()
    agent = get_agent(llm)

    def dispatch(event: Any) -> None:
        sink = entry["sink"]
        if sink is None:
            return
        payload = event_to_payload(event)
        if payload:
            sink(payload)

    oh_conv = OHConversation(
        agent=agent,
        workspace=workspace_path,
        callbacks=[dispatch],
        delete_on_close=False,
    )
    entry: Dict[str, Any] = {
        "llm": llm,
        "agent": agent,
        "conversation": oh_conv,
        "workspace_path": workspace_path,
        "sink": None,
    }
    return entry


@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    message: MessageCreate,
    db: Session = Depends(get_db),
):
    """Send a message and stream the agent's output back as SSE."""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    user_msg_id = str(uuid.uuid4())
    db.add(
        MessageDB(
            id=user_msg_id,
            conversation_id=conversation_id,
            role="user",
            content=message.content,
        )
    )
    db_conv.status = "running"
    db_conv.updated_at = datetime.utcnow()
    db.commit()

    workspace_path = f"./workspaces/{conversation_id}"
    os.makedirs(workspace_path, exist_ok=True)

    msg_id = str(uuid.uuid4())

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def sink(payload: Dict[str, str]) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        entry = active_conversations.get(conversation_id)
        if entry is None:
            entry = build_conversation(conversation_id, workspace_path)
            active_conversations[conversation_id] = entry
        oh_conv = entry["conversation"]
        # Route this request's events to this request's queue.
        entry["sink"] = sink

        yield {"event": "message_start", "data": json.dumps({"id": msg_id, "role": "assistant"})}

        chunks: List[str] = []
        error_text: Optional[str] = None

        def drive() -> None:
            try:
                oh_conv.send_message(message.content)
                oh_conv.run()
            except Exception as exc:  # surfaced to the browser below
                loop.call_soon_threadsafe(queue.put_nowait, {"kind": "error", "content": str(exc), "tool": ""})
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        runner = asyncio.create_task(asyncio.to_thread(drive))
        try:
            while True:
                payload = await queue.get()
                if payload is None:
                    break
                if payload["kind"] == "error":
                    error_text = payload["content"]
                    yield {"event": "error", "data": json.dumps({"error": payload["content"]})}
                    continue
                chunks.append(payload["content"])
                yield {"event": "content", "data": json.dumps({"content": payload["content"], "kind": payload["kind"], "tool": payload["tool"]})}
        finally:
            await runner
            entry["sink"] = None

        db.add(
            MessageDB(
                id=msg_id,
                conversation_id=conversation_id,
                role="assistant",
                content="\n\n".join(chunks) if chunks else (error_text or ""),
            )
        )
        db_conv.status = "idle"
        db_conv.updated_at = datetime.utcnow()
        db.commit()

        yield {"event": "message_end", "data": json.dumps({"id": msg_id})}

    return EventSourceResponse(event_generator())


@app.post("/api/conversations/{conversation_id}/stop")
async def stop_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Stop a running conversation."""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    entry = active_conversations.get(conversation_id)
    if entry is not None:
        entry["conversation"].interrupt()

    db_conv.status = "idle"
    db.commit()

    return {"message": "Conversation stopped"}


@app.post("/api/conversations/{conversation_id}/pause")
async def pause_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Pause a running conversation."""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    entry = active_conversations.get(conversation_id)
    if entry is not None:
        entry["conversation"].pause()

    db_conv.status = "paused"
    db.commit()

    return {"message": "Conversation paused"}


@app.post("/api/conversations/{conversation_id}/resume")
async def resume_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Resume a paused conversation."""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    entry = active_conversations.get(conversation_id)
    if entry is not None:
        await asyncio.to_thread(entry["conversation"].run)

    db_conv.status = "idle"
    db.commit()

    return {"message": "Conversation resumed"}


@app.get("/api/conversations/{conversation_id}/files")
async def list_files(conversation_id: str):
    """List files in conversation workspace"""
    if conversation_id not in active_conversations:
        workspace_path = f"./workspaces/{conversation_id}"
    else:
        workspace_path = active_conversations[conversation_id]["workspace_path"]
    
    if not os.path.exists(workspace_path):
        return {"files": []}
    
    files = []
    for root, dirs, filenames in os.walk(workspace_path):
        for filename in filenames:
            filepath = os.path.join(root, filename)
            rel_path = os.path.relpath(filepath, workspace_path)
            stat = os.stat(filepath)
            files.append({
                "name": filename,
                "path": rel_path,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
    
    return {"files": files}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)