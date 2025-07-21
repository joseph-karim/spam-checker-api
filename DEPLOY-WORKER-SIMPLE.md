# 🚀 Deploy Simple Cloudflare Worker MCP Server

## The Problem
Your current Cloudflare Pages deployment is failing because it's trying to build a React app instead of a Worker.

## Quick Fix - Use Wrangler CLI

### 1. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 2. Deploy the Worker Directly
```bash
# Copy the worker files
cp worker-package.json package.json
cp wrangler-worker.toml wrangler.toml

# Install dependencies
npm install

# Set your secrets
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN

# Deploy
wrangler deploy
```

### 3. Get Your MCP URL
After deployment, you'll get a URL like:
`https://spam-checker-mcp.your-subdomain.workers.dev/mcp`

### 4. Test It
```bash
# Test health endpoint
curl https://spam-checker-mcp.your-subdomain.workers.dev/health

# Test MCP endpoint
curl -X POST https://spam-checker-mcp.your-subdomain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize"
  }'
```

### 5. Connect to ChatGPT
1. Go to ChatGPT Settings → Connectors
2. Add your Worker URL: `https://spam-checker-mcp.your-subdomain.workers.dev/mcp`
3. Test with: "search for spam on +12345678901"

## Alternative: GitHub Actions Auto-Deploy

If you prefer automated deployment from GitHub:

### 1. Add GitHub Secrets
In your GitHub repo settings, add:
- `CLOUDFLARE_API_TOKEN`
- `TWILIO_ACCOUNT_SID` 
- `TWILIO_AUTH_TOKEN`

### 2. Create GitHub Action
```yaml
# .github/workflows/deploy-worker.yml
name: Deploy MCP Worker
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          secrets: |
            TWILIO_ACCOUNT_SID
            TWILIO_AUTH_TOKEN
          environment: production
```

## Why This Works
- ✅ No build step required (pure JavaScript)
- ✅ No external dependencies
- ✅ Works with ChatGPT MCP protocol
- ✅ Handles CORS automatically
- ✅ Simple deployment process

Your MCP server will be live in 2 minutes! 🎉