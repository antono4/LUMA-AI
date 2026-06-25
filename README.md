# LUMA AI - AI Assistant

A modern AI assistant powered by OpenHands Cloud API.

![LUMA AI](https://img.shields.io/badge/LUMA-AI-v1.0.0-purple)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- 🤖 AI-powered coding assistant
- 💬 Real-time chat interface
- 🔒 Secure API integration with OpenHands Cloud
- 🎨 Modern, responsive UI with dark theme
- 📱 Mobile-friendly design

## Quick Start

### Using Docker

```bash
# Clone the repository
git clone https://github.com/antono4/LUMA-AI.git
cd LUMA-AI

# Set your API key
export OPENHANDS_API_KEY=your_api_key_here

# Run with Docker Compose
docker-compose up -d
```

### Manual Setup

#### Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your OPENHANDS_API_KEY

# Run server
python main.py
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENHANDS_API_KEY` | OpenHands Cloud API key | Yes |

## API Endpoints

- `GET /` - API info
- `GET /health` - Health check
- `POST /api/conversations` - Create conversation
- `GET /api/conversations` - List conversations
- `GET /api/conversations/{id}` - Get conversation
- `DELETE /api/conversations/{id}` - Delete conversation
- `POST /api/conversations/{id}/messages` - Send message

## Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS, Vite
- **Backend**: Python, FastAPI, SQLAlchemy
- **AI**: OpenHands Cloud API

## Deployment

### Docker

```bash
# Build image
docker build -t luma-ai .

# Run container
docker run -d -p 8000:8000 \
  -e OPENHANDS_API_KEY=your_key \
  luma-ai
```

### Railway

1. Connect your GitHub repository
2. Add environment variable: `OPENHANDS_API_KEY`
3. Set build command: `pip install -r backend/requirements.txt`
4. Set start command: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`

### Render

1. Create Web Service
2. Connect GitHub repository
3. Set build command: `pip install -r backend/requirements.txt`
4. Set start command: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variable: `OPENHANDS_API_KEY`

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
