# 🚀 Deploy Spam Checker MCP to Cloudflare Workers

## Quick Setup (10 minutes)

### 1. Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### 2. Initialize Project
```bash
# Copy the Cloudflare files to a new directory
mkdir spam-checker-mcp-cf
cd spam-checker-mcp-cf

# Copy these files:
# - src/index.ts
# - wrangler.toml  
# - package-cf.json (rename to package.json)

npm install
```

### 3. Set Environment Variables
```bash
# Set your Twilio credentials as secrets
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
```

### 4. Deploy
```bash
# Deploy to Cloudflare Workers
wrangler deploy --env production

# Your MCP server will be available at:
# https://spam-checker-mcp.your-subdomain.workers.dev/mcp
```

### 5. Test the Deployment
```bash
# Test the health endpoint
curl https://spam-checker-mcp.your-subdomain.workers.dev/health

# Test the MCP endpoint
curl -X POST https://spam-checker-mcp.your-subdomain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

### 6. Connect to ChatGPT
1. Go to ChatGPT Settings → Connectors
2. Add your Cloudflare Workers URL: `https://spam-checker-mcp.your-subdomain.workers.dev/mcp`
3. Test with: "search for spam reports on +12345678901"

## Configuration

### wrangler.toml Settings
- Update the `name` field to match your preferred worker name
- The worker will be deployed to `https://[name].[subdomain].workers.dev`

### Environment Variables
Set via Wrangler CLI:
- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token

## Usage Examples

Once deployed, your MCP server supports these tools:

### Search Tool
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search",
    "arguments": {
      "query": "+12345678901"
    }
  }
}
```

### Fetch Tool
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "fetch",
    "arguments": {
      "id": "spam_check_abc12345"
    }
  }
}
```

## Benefits of Cloudflare Workers

✅ **Fast**: Edge deployment worldwide  
✅ **Reliable**: 99.99% uptime SLA  
✅ **Scalable**: Auto-scales to handle any load  
✅ **Affordable**: Free tier includes 100,000 requests/day  
✅ **Simple**: No server management required

## Cost
- **Free tier**: 100,000 requests/day
- **Paid tier**: $5/month for 10M requests
- **Twilio costs**: ~$0.013 per phone number lookup

Your spam checker MCP server is now ready for ChatGPT integration! 🎉