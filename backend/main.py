"""
LUMA AI Assistant Backend
FastAPI server with OpenHands Cloud API integration
"""

import os
import uuid
import json
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

# OpenHands Cloud API Configuration
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
    if not OPENHANDS_API_KEY:
        print("⚠️ WARNING: OPENHANDS_API_KEY not set. Please set it in .env file.")
    yield
    print("👋 Shutting down...")


# FastAPI App
app = FastAPI(
    title="LUMA AI Assistant",
    description="AI-powered development assistant powered by OpenHands Cloud",
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
    """Send a message and get streaming response via OpenHands Cloud API"""
    if not OPENHANDS_API_KEY:
        raise HTTPException(status_code=500, detail="OpenHands API key not configured")
    
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
            async with httpx.AsyncClient(timeout=300.0) as client:
                # Call OpenHands Cloud API - create conversation with initial message
                response = await client.post(
                    f"{OPENHANDS_API_BASE_URL}/app-conversations",
                    headers=get_headers(),
                    json={
                        "initial_message": {
                            "content": [{"type": "text", "text": message.content}]
                        }
                    },
                    timeout=300.0
                )
                
                if response.status_code in (200, 201):
                    response_data = response.json()
                    # Extract response from OpenHands API
                    full_response = response_data.get("response", "")
                    if not full_response:
                        full_response = "Conversation started. Check OpenHands dashboard for details."
                    
                    # Store the OpenHands conversation ID
                    oh_conv_id = response_data.get("app_conversation_id") or response_data.get("id")
                    if oh_conv_id and not db_conv.oh_conversation_id:
                        db_conv.oh_conversation_id = oh_conv_id
                        db.commit()
                    
                    # Stream the response content
                    yield {
                        "event": "content",
                        "data": json.dumps({"content": full_response})
                    }
                else:
                    error_msg = f"OpenHands API error: {response.status_code} - {response.text}"
                    yield {
                        "event": "error",
                        "data": json.dumps({"error": error_msg})
                    }
                    full_response = error_msg
                    
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