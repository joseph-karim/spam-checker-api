# 🚀 Deploy to Replit (5 Minutes)

## Step 1: Create Replit Project
1. Go to [replit.com](https://replit.com)
2. Click "Create Repl"
3. Choose "Python"
4. Name it "spam-checker-mcp"

## Step 2: Upload Code
Copy these two files to your Replit:

**main.py** (rename from mcp_spam_server.py)
**requirements.txt** (rename from requirements-mcp.txt)

## Step 3: Set Environment Variables
In Replit, go to "Secrets" tab and add:
- `TWILIO_ACCOUNT_SID`: your_twilio_account_sid
- `TWILIO_AUTH_TOKEN`: your_twilio_auth_token

## Step 4: Run
Click the green "Run" button

## Step 5: Get Your MCP URL
Copy the URL from the webview, add `/sse/` at the end:
`https://[random-id].replit.dev/sse/`

## Step 6: Connect to ChatGPT
1. Go to ChatGPT Settings → Connectors
2. Add your Replit URL with `/sse/`
3. Test with: "check +12345678901 for spam"

**Done!** Your MCP server is live and ready for ChatGPT agent mode.