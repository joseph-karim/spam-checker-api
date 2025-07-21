"""
MCP Endpoint URL: /v1/classify
Authentication: Bearer token (OAuth2)
Example usage:
    POST /v1/classify
    Headers: Authorization: Bearer <token>
    Body: {"phone_number": "+12345678901"}
"""
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import Any
import os
import httpx
from datetime import datetime
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends
from starlette.status import HTTP_401_UNAUTHORIZED

app = FastAPI()

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")

# Simple in-memory token for demonstration (replace with real OAuth2 in production)
OAUTH2_TOKEN = os.getenv("MCP_OAUTH2_TOKEN", "testtoken123")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def verify_token(token: str = Depends(oauth2_scheme)):
    if token != OAUTH2_TOKEN:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token

class SpamScoreRequest(BaseModel):
    phone_number: str

class SpamScoreResponse(BaseModel):
    spam_score: int
    checked_at: str

class MCPClassifyRequest(BaseModel):
    phone_number: str

class MCPClassifyResponse(BaseModel):
    result: dict
    model_version: str = "1.0"
    created_at: str

# E.164 validation (simple)
def is_e164(number: str) -> bool:
    return number.startswith("+") and number[1:].isdigit() and 10 <= len(number) <= 15

@app.post("/api/v1/spam_score", response_model=SpamScoreResponse)
async def spam_score(request: SpamScoreRequest):
    if not is_e164(request.phone_number):
        raise HTTPException(status_code=400, detail="Invalid phone number format. Must be E.164.")

    url = f"https://lookups.twilio.com/v1/PhoneNumbers/{request.phone_number}"
    params = {"AddOns": "nomorobo_spamscore"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params=params, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), timeout=10)
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Phone number not found.")
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Twilio authentication failed.")
        if resp.status_code == 429:
            raise HTTPException(status_code=503, detail="Twilio rate limit exceeded. Please try again later.")
        resp.raise_for_status()
        data = resp.json()
        # Parse Nomorobo score
        add_ons = data.get("add_ons", {})
        results = add_ons.get("results", {})
        nomorobo = results.get("nomorobo_spamscore", {})
        result = nomorobo.get("result", {})
        score = result.get("score")
        if score is None:
            raise HTTPException(status_code=502, detail="Nomorobo score not available.")
        return SpamScoreResponse(spam_score=score, checked_at=datetime.utcnow().isoformat() + "Z")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Error contacting Twilio: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/v1/classify", response_model=MCPClassifyResponse)
async def mcp_classify(request: MCPClassifyRequest, token: str = Depends(verify_token)):
    # Reuse the E.164 validation
    if not is_e164(request.phone_number):
        raise HTTPException(status_code=400, detail="Invalid phone number format. Must be E.164.")
    # Reuse the Twilio lookup logic
    url = f"https://lookups.twilio.com/v1/PhoneNumbers/{request.phone_number}"
    params = {"AddOns": "nomorobo_spamscore"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params=params, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), timeout=10)
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Phone number not found.")
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Twilio authentication failed.")
        if resp.status_code == 429:
            raise HTTPException(status_code=503, detail="Twilio rate limit exceeded. Please try again later.")
        resp.raise_for_status()
        data = resp.json()
        add_ons = data.get("add_ons", {})
        results = add_ons.get("results", {})
        nomorobo = results.get("nomorobo_spamscore", {})
        result = nomorobo.get("result", {})
        score = result.get("score")
        if score is None:
            raise HTTPException(status_code=502, detail="Nomorobo score not available.")
        return MCPClassifyResponse(
            result={
                "phone_number": request.phone_number,
                "spam_score": score
            },
            created_at=datetime.utcnow().isoformat() + "Z"
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Error contacting Twilio: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# --- MCP Server for Deep Research ---
import threading
from fastmcp import FastMCP
import logging

# Example in-memory data for MCP
DOCUMENTS = [
    {
        "id": "doc1",
        "title": "Cats and Their Homes",
        "text": "Cats are often attached to their homes rather than their owners...",
        "url": "https://example.com/cats-homes",
        "metadata": {"author": "Jane Doe"}
    },
    {
        "id": "doc2",
        "title": "The History of Cats",
        "text": "Cats have been domesticated for thousands of years...",
        "url": "https://example.com/history-cats",
        "metadata": {"author": "John Smith"}
    }
]

server_instructions = """
This MCP server provides search and document retrieval capabilities
for deep research. Use the search tool to find relevant documents
based on keywords, then use the fetch tool to retrieve complete
document content with citations.
"""

def create_mcp_server():
    mcp = FastMCP(name="Demo Deep Research MCP Server", instructions=server_instructions)

    @mcp.tool()
    async def search(query: str):
        results = []
        for doc in DOCUMENTS:
            if query.lower() in doc["text"].lower() or query.lower() in doc["title"].lower():
                results.append({
                    "id": doc["id"],
                    "title": doc["title"],
                    "text": doc["text"][:200] + ("..." if len(doc["text"]) > 200 else ""),
                    "url": doc["url"]
                })
        return {"results": results}

    @mcp.tool()
    async def fetch(id: str):
        for doc in DOCUMENTS:
            if doc["id"] == id:
                return {
                    "id": doc["id"],
                    "title": doc["title"],
                    "text": doc["text"],
                    "url": doc["url"],
                    "metadata": doc.get("metadata", {})
                }
        return {"error": "Document not found"}

    return mcp

def run_mcp_server():
    logging.basicConfig(level=logging.INFO)
    mcp_server = create_mcp_server()
    mcp_server.run(transport="sse", host="0.0.0.0", port=8001)

if __name__ == "__main__":
    # Start MCP server in a separate thread
    mcp_thread = threading.Thread(target=run_mcp_server, daemon=True)
    mcp_thread.start()
    # Start FastAPI app as usual (e.g., with uvicorn)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 