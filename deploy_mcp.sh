#!/bin/bash

# Spam Checker MCP Server Deployment Script

set -e

echo "🚀 Deploying Spam Checker MCP Server..."

# Check if environment variables are set
if [ -z "$TWILIO_ACCOUNT_SID" ] || [ -z "$TWILIO_AUTH_TOKEN" ]; then
    echo "❌ Error: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set"
    echo "Please copy .env.mcp.example to .env.mcp and configure your credentials"
    exit 1
fi

echo "✅ Environment variables configured"

# Install Python dependencies
echo "📦 Installing dependencies..."
pip install -r requirements-mcp.txt

# Test the server configuration
echo "🧪 Testing server configuration..."
python -c "
import os
from mcp_spam_server import create_server
server = create_server()
print('✅ MCP server configuration is valid')
"

# Build Docker image (optional)
if command -v docker &> /dev/null; then
    echo "🐳 Building Docker image..."
    docker build -f Dockerfile.mcp -t spam-checker-mcp:latest .
    echo "✅ Docker image built successfully"
fi

echo "🎉 Deployment preparation complete!"
echo ""
echo "To start the MCP server:"
echo "1. Standalone:  python mcp_spam_server.py"
echo "2. Docker:      docker-compose -f docker-compose.mcp.yml up -d"
echo ""
echo "MCP Server will be available at:"
echo "- Local:  http://localhost:8001/sse/"
echo "- Docker: http://localhost:8001/sse/"
echo ""
echo "For ChatGPT integration, use the /sse/ endpoint URL."