"""
OpenHands-like AI Assistant Backend
FastAPI server with OpenHands SDK integration
"""

import os
import uuid
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Text, DateTime, Float, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sse_starlette.sse import EventSourceResponse

# OpenHands SDK imports
from openhands.sdk import LLM, Agent
from openhands.sdk.conversation import Conversation as OHConversation

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
    """Initialize LLM with environment variables"""
    return LLM(
        model=os.getenv("LLM_MODEL", "gpt-4o"),
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("LLM_BASE_URL"),
    )


def get_agent(llm: LLM) -> Agent:
    """Create agent with default tools"""
    return Agent(
        llm=llm,
    )


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
    
    # Initialize OpenHands conversation
    workspace_path = f"./workspaces/{conv_id}"
    os.makedirs(workspace_path, exist_ok=True)
    
    llm = get_llm()
    agent = get_agent(llm)
    oh_conv = OHConversation(agent=agent, workspace=workspace_path)
    
    active_conversations[conv_id] = {
        "llm": llm,
        "agent": agent,
        "conversation": oh_conv,
        "workspace_path": workspace_path,
    }
    
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
    
    # Remove from active conversations
    if conversation_id in active_conversations:
        del active_conversations[conversation_id]
    
    # Delete messages
    db.query(MessageDB).filter(MessageDB.conversation_id == conversation_id).delete()
    db.delete(db_conv)
    db.commit()
    
    return {"message": "Conversation deleted"}


@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    message: MessageCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Send a message and get streaming response"""
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
        if conversation_id not in active_conversations:
            llm = get_llm()
            agent = get_agent(llm)
            workspace_path = f"./workspaces/{conversation_id}"
            os.makedirs(workspace_path, exist_ok=True)
            oh_conv = OHConversation(agent=agent, workspace=workspace_path)
            active_conversations[conversation_id] = {
                "llm": llm,
                "agent": agent,
                "conversation": oh_conv,
                "workspace_path": workspace_path,
            }
        
        oh_conv = active_conversations[conversation_id]["conversation"]
        
        # Send message to OpenHands
        oh_conv.send_message(message.content)
        
        # Stream responses
        full_response = ""
        msg_id = str(uuid.uuid4())
        
        yield {
            "event": "message_start",
            "data": f'{{"id": "{msg_id}", "role": "assistant"}}'
        }
        
        # Run conversation and stream output
        try:
            for event in oh_conv.run_iter(events=['action', 'observation']):
                event_type = event.get("type", "")
                event_data = event.get("data", {})
                
                if event_type == "action":
                    action = event_data.get("action", "")
                    content = event_data.get("content", "")
                    if content:
                        full_response += f"{content}\n"
                        yield {
                            "event": "content",
                            "data": f'{{"content": {repr(content)}}}'
                        }
                
                elif event_type == "observation":
                    observation = event_data.get("observation", "")
                    content = event_data.get("content", "")
                    if content:
                        full_response += f"[{observation}] {content}\n"
                        yield {
                            "event": "content",
                            "data": f'{{"content": "[{observation}] {content}"}}'
                        }
                        
        except Exception as e:
            yield {
                "event": "error",
                "data": f'{{"error": "{str(e)}"}}'
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
            "data": f'{{"id": "{msg_id}"}}'
        }
    
    return EventSourceResponse(event_generator())


@app.post("/api/conversations/{conversation_id}/stop")
async def stop_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Stop a running conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation_id in active_conversations:
        oh_conv = active_conversations[conversation_id]["conversation"]
        oh_conv.stop()
    
    db_conv.status = "idle"
    db.commit()
    
    return {"message": "Conversation stopped"}


@app.post("/api/conversations/{conversation_id}/pause")
async def pause_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Pause a running conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation_id in active_conversations:
        oh_conv = active_conversations[conversation_id]["conversation"]
        oh_conv.pause()
        db_conv.status = "paused"
        db.commit()
    
    return {"message": "Conversation paused"}


@app.post("/api/conversations/{conversation_id}/resume")
async def resume_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Resume a paused conversation"""
    db_conv = db.query(ConversationDB).filter(ConversationDB.id == conversation_id).first()
    if not db_conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation_id in active_conversations:
        oh_conv = active_conversations[conversation_id]["conversation"]
        oh_conv.resume()
        db_conv.status = "running"
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