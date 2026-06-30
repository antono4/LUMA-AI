"""
LUMA AI Assistant Backend
FastAPI server with Ollama (FREE) or OpenHands Cloud API integration
"""

import os
import uuid
import json
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sse_starlette.sse import EventSourceResponse

# Load environment variables from .env file
load_dotenv()

# ============================================
# AI PROVIDER CONFIGURATION
# ============================================
# Set AI_PROVIDER to "ollama" for FREE local AI, or "openai" for OpenAI API
# For Ollama, download from: https://ollama.ai
AI_PROVIDER = os.getenv("AI_PROVIDER", "ollama").lower()

# Ollama Configuration (FREE - local AI)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")  # Default model, change to "mistral", "phi3", etc.

# OpenAI Configuration (if using OpenAI)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# OpenHands Cloud API Configuration (legacy)
OPENHANDS_API_BASE_URL = "https://app.all-hands.dev/api/v1"
OPENHANDS_API_KEY = os.getenv("OPENHANDS_API_KEY", "")

# Database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./conversations.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# Database Models
class ConversationDB(Base):
    __tablename__ = "conversations"
    
    id = Column(String, primary_key=True, index=True)
    oh_conversation_id = Column(String, nullable=True)  # OpenHands Cloud conversation ID
    title = Column(String, default="New Conversation")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    status = Column(String, default="idle")  # idle, running, paused, completed


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


# In-memory conversation state
active_conversations: Dict[str, Dict[str, Any]] = {}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_headers() -> Dict[str, str]:
    """Get headers with API key for OpenHands Cloud API"""
    return {
        "Authorization": f"Bearer {OPENHANDS_API_KEY}",
        "Content-Type": "application/json",
    }


# Lifespan for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting LUMA AI Assistant...")
    
    # Display AI Provider info
    if AI_PROVIDER == "ollama":
        print(f"🤖 Using OLLAMA (FREE local AI) - {OLLAMA_BASE_URL}")
        print(f"   Model: {OLLAMA_MODEL}")
        print("   💡 Make sure Ollama is installed and running!")
        print("   📥 Install: https://ollama.ai")
        print("   🚀 Run: ollama serve")
    elif AI_PROVIDER == "openai":
        print(f"🤖 Using OpenAI API - Model: {OPENAI_MODEL}")
        if not OPENAI_API_KEY:
            print("⚠️ WARNING: OPENAI_API_KEY not set!")
    else:
        print("⚠️ WARNING: Unknown AI_PROVIDER. Set AI_PROVIDER=ollama or openai in .env")
    
    yield
    print("👋 Shutting down...")


# FastAPI App
app = FastAPI(
    title="LUMA AI Assistant",
    description="AI-powered assistant using FREE Ollama (local) or OpenAI API",
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
    return {"message": "LUMA AI Assistant API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


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
    
    # Delete messages
    db.query(MessageDB).filter(MessageDB.conversation_id == conversation_id).delete()
    db.delete(db_conv)
    db.commit()
    
    return {"message": "Conversation deleted"}


@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    message: MessageCreate,
    db: Session = Depends(get_db)
):
    """Send a message and get streaming response via configured AI provider"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Save user message
    user_msg_id = str(uuid.uuid4())
    db_msg = MessageDB(
        id=user_msg_id,
        conversation_id=conversation_id,
        role="user",
        content=message.content
    )
    db.add(db_msg)
    db.commit()
    
    # Update conversation status
    db_conv.status = "running"
    db_conv.updated_at = datetime.utcnow()
    db.commit()
    
    async def event_generator():
        full_response = ""
        msg_id = str(uuid.uuid4())
        
        yield {
            "event": "message_start",
            "data": json.dumps({"id": msg_id, "role": "assistant"})
        }
        
        try:
            if AI_PROVIDER == "ollama":
                # =====================
                # OLLAMA (FREE LOCAL AI)
                # =====================
                async with httpx.AsyncClient(timeout=300.0) as client:
                    # First, check if Ollama is available
                    try:
                        health_resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
                        if health_resp.status_code != 200:
                            yield {
                                "event": "error",
                                "data": json.dumps({"error": "Ollama is not running. Please install and start Ollama."})
                            }
                            return
                    except Exception:
                        yield {
                            "event": "error",
                            "data": json.dumps({"error": "Cannot connect to Ollama. Make sure Ollama is installed and running on " + OLLAMA_BASE_URL})
                        }
                        return
                    
                    # Get conversation history for context
                    db_messages = db.query(MessageDB).filter(
                        MessageDB.conversation_id == conversation_id
                    ).order_by(MessageDB.created_at).all()
                    
                    # Build messages array for context
                    messages_history = [
                        {"role": m.role, "content": m.content}
                        for m in db_messages[:-1]  # Exclude the new message we just added
                    ]
                    
                    # Stream response from Ollama
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_BASE_URL}/api/chat",
                        json={
                            "model": OLLAMA_MODEL,
                            "messages": messages_history + [{"role": "user", "content": message.content}],
                            "stream": True
                        },
                        timeout=300.0
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    try:
                                        data = json.loads(line)
                                        if "message" in data and "content" in data["message"]:
                                            chunk = data["message"]["content"]
                                            full_response += chunk
                                            yield {
                                                "event": "content",
                                                "data": json.dumps({"content": chunk})
                                            }
                                        if data.get("done", False):
                                            break
                                    except json.JSONDecodeError:
                                        continue
                        else:
                            error_msg = f"Ollama API error: {response.status_code}"
                            yield {
                                "event": "error",
                                "data": json.dumps({"error": error_msg})
                            }
                            full_response = error_msg
                            
            elif AI_PROVIDER == "openai":
                # =====================
                # OPENAI API
                # =====================
                if not OPENAI_API_KEY:
                    yield {
                        "event": "error",
                        "data": json.dumps({"error": "OpenAI API key not configured"})
                    }
                    return
                
                async with httpx.AsyncClient(timeout=300.0) as client:
                    # Get conversation history for context
                    db_messages = db.query(MessageDB).filter(
                        MessageDB.conversation_id == conversation_id
                    ).order_by(MessageDB.created_at).all()
                    
                    messages_history = [
                        {"role": m.role, "content": m.content}
                        for m in db_messages[:-1]
                    ]
                    
                    response = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {OPENAI_API_KEY}",
                            "Content-Type": "application/json"
                        },
                        json={
                            "model": OPENAI_MODEL,
                            "messages": messages_history + [{"role": "user", "content": message.content}],
                            "stream": True
                        },
                        timeout=300.0
                    )
                    
                    if response.status_code == 200:
                        async for line in response.aiter_lines():
                            if line.strip() and line.startswith("data: "):
                                data_str = line[6:]  # Remove "data: " prefix
                                if data_str == "[DONE]":
                                    break
                                try:
                                    data = json.loads(data_str)
                                    if "choices" in data and len(data["choices"]) > 0:
                                        delta = data["choices"][0].get("delta", {})
                                        if "content" in delta:
                                            chunk = delta["content"]
                                            full_response += chunk
                                            yield {
                                                "event": "content",
                                                "data": json.dumps({"content": chunk})
                                            }
                                except json.JSONDecodeError:
                                    continue
                    else:
                        error_msg = f"OpenAI API error: {response.status_code}"
                        yield {
                            "event": "error",
                            "data": json.dumps({"error": error_msg})
                        }
                        full_response = error_msg
            else:
                yield {
                    "event": "error",
                    "data": json.dumps({"error": f"Unknown AI provider: {AI_PROVIDER}. Set AI_PROVIDER=ollama or openai in .env"})
                }
                full_response = "Unknown AI provider"
                    
        except Exception as e:
            full_response = f"Error: {str(e)}"
            yield {
                "event": "error",
                "data": json.dumps({"error": full_response})
            }
        
        # Save assistant message
        assistant_msg = MessageDB(
            id=msg_id,
            conversation_id=conversation_id,
            role="assistant",
            content=full_response
        )
        db.add(assistant_msg)
        db_conv.status = "idle"
        db.commit()
        
        yield {
            "event": "message_end",
            "data": json.dumps({"id": msg_id})
        }
    
    return EventSourceResponse(event_generator())


@app.post("/api/conversations/{conversation_id}/stop")
async def stop_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Stop a running conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    db_conv.status = "idle"
    db.commit()
    
    return {"message": "Conversation stopped"}


@app.post("/api/conversations/{conversation_id}/pause")
async def pause_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Pause a running conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    db_conv.status = "paused"
    db.commit()
    
    return {"message": "Conversation paused"}


@app.post("/api/conversations/{conversation_id}/resume")
async def resume_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Resume a paused conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    db_conv.status = "running"
    db.commit()
    
    return {"message": "Conversation resumed"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)