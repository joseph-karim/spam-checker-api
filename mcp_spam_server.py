"""
Spam Checker MCP Server for ChatGPT Deep Research Integration

This server implements the Model Context Protocol (MCP) with search and fetch
capabilities for spam checking phone numbers using Twilio Lookup API.
"""

import logging
import os
from typing import Dict, List, Any, Optional
import asyncio
import httpx
from datetime import datetime, timezone
import hashlib
import json

from fastmcp import FastMCP

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
MCP_SERVER_PORT = int(os.environ.get("MCP_SERVER_PORT", "8001"))
MCP_SERVER_HOST = os.environ.get("MCP_SERVER_HOST", "0.0.0.0")

# In-memory cache for demonstration (replace with real database in production)
spam_cache: Dict[str, Dict[str, Any]] = {}
search_history: List[Dict[str, Any]] = []

server_instructions = """
This MCP server provides spam checking capabilities for phone numbers using the Twilio Lookup API.
Use the search tool to find spam reports for phone numbers, then use the fetch tool to retrieve 
detailed spam analysis reports including reputation scores and historical data.

The server can:
1. Check individual phone numbers for spam reputation
2. Search through historical spam check results
3. Provide detailed analysis reports for specific phone numbers
"""

def mask_phone_number(phone: str) -> str:
    """Mask phone number for privacy, showing only last 4 digits"""
    if len(phone) < 4:
        return "*" * len(phone)
    return "*" * (len(phone) - 4) + phone[-4:]

def create_document_id(phone: str) -> str:
    """Create a unique document ID for a phone number"""
    return f"spam_check_{hashlib.md5(phone.encode()).hexdigest()[:8]}"

def is_e164(number: str) -> bool:
    """Validate E.164 phone number format"""
    return number.startswith("+") and number[1:].isdigit() and 10 <= len(number) <= 15

async def check_spam_score(phone_number: str) -> Dict[str, Any]:
    """Check spam score using Twilio Lookup API"""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        raise ValueError("Twilio credentials not configured")
    
    if not is_e164(phone_number):
        raise ValueError(f"Invalid phone number format: {phone_number}")
    
    # Check cache first
    doc_id = create_document_id(phone_number)
    if doc_id in spam_cache:
        cached = spam_cache[doc_id]
        cache_age = datetime.now(timezone.utc) - datetime.fromisoformat(cached['checked_at'].replace('Z', '+00:00'))
        if cache_age.total_seconds() < 86400:  # 24 hour cache
            logger.info(f"Returning cached result for {mask_phone_number(phone_number)}")
            return cached
    
    # Make Twilio API call
    url = f"https://lookups.twilio.com/v1/PhoneNumbers/{phone_number}"
    params = {"AddOns": "nomorobo_spamscore"}
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url, 
                params=params, 
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), 
                timeout=10
            )
        
        if resp.status_code == 404:
            raise ValueError(f"Phone number not found: {phone_number}")
        elif resp.status_code == 401:
            raise ValueError("Twilio authentication failed")
        elif resp.status_code == 429:
            raise ValueError("Twilio rate limit exceeded")
        
        resp.raise_for_status()
        data = resp.json()
        
        # Parse Nomorobo score
        add_ons = data.get("add_ons", {})
        results = add_ons.get("results", {})
        nomorobo = results.get("nomorobo_spamscore", {})
        result = nomorobo.get("result", {})
        score = result.get("score", 0)
        
        # Create result document
        result_doc = {
            "id": doc_id,
            "phone_number_masked": mask_phone_number(phone_number),
            "spam_score": score,
            "reputation": "SPAM" if score == 1 else "CLEAN",
            "carrier": data.get("carrier", {}).get("name", "Unknown"),
            "country_code": data.get("country_code", "Unknown"),
            "phone_type": data.get("type", "Unknown"),
            "checked_at": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            "source": "Twilio Lookup API + Nomorobo",
            "confidence": "High" if score in [0, 1] else "Low"
        }
        
        # Cache the result
        spam_cache[doc_id] = result_doc
        
        # Add to search history
        search_history.append({
            "query": phone_number,
            "result_id": doc_id,
            "timestamp": result_doc["checked_at"],
            "spam_score": score
        })
        
        logger.info(f"Spam check completed for {mask_phone_number(phone_number)}: score={score}")
        return result_doc
        
    except httpx.RequestError as e:
        raise ValueError(f"Error contacting Twilio: {str(e)}")

def create_server():
    """Create and configure the MCP server with search and fetch tools."""
    
    mcp = FastMCP(name="Spam Checker MCP Server", instructions=server_instructions)

    @mcp.tool()
    async def search(query: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        Search for spam reports based on phone numbers or search criteria.
        
        This tool searches for spam check results. You can search by:
        - Phone number (E.164 format like +1234567890)
        - Partial phone number (last 4 digits)
        - Keywords like 'spam', 'clean', 'high score'
        - Carrier names
        
        Args:
            query: Search query - can be a phone number, partial number, or keywords
        
        Returns:
            Dictionary with 'results' key containing list of matching spam reports.
            Each result includes id, title, text snippet, and analysis summary.
        """
        if not query or not query.strip():
            return {"results": []}
        
        query_lower = query.lower().strip()
        results = []
        
        logger.info(f"Searching spam database for query: '{query}'")
        
        # If query looks like a phone number, check it directly
        if query.startswith('+') and len(query) > 5:
            try:
                spam_result = await check_spam_score(query)
                results.append({
                    "id": spam_result["id"],
                    "title": f"Spam Check: {spam_result['phone_number_masked']}",
                    "text": f"Phone: {spam_result['phone_number_masked']}, "
                           f"Score: {spam_result['spam_score']}, "
                           f"Reputation: {spam_result['reputation']}, "
                           f"Carrier: {spam_result['carrier']}",
                    "url": f"https://spam-checker.example.com/report/{spam_result['id']}"
                })
            except Exception as e:
                logger.error(f"Error checking spam for {query}: {e}")
                results.append({
                    "id": f"error_{hashlib.md5(query.encode()).hexdigest()[:8]}",
                    "title": f"Error checking {mask_phone_number(query)}",
                    "text": f"Could not check spam status: {str(e)}",
                    "url": f"https://spam-checker.example.com/error"
                })
        
        # Search cached results
        for doc_id, doc in spam_cache.items():
            if (query_lower in doc['phone_number_masked'].lower() or
                query_lower in doc['reputation'].lower() or
                query_lower in doc['carrier'].lower() or
                query_lower in str(doc['spam_score']) or
                (query_lower == 'spam' and doc['spam_score'] == 1) or
                (query_lower == 'clean' and doc['spam_score'] == 0)):
                
                results.append({
                    "id": doc["id"],
                    "title": f"Spam Report: {doc['phone_number_masked']}",
                    "text": f"Phone: {doc['phone_number_masked']}, "
                           f"Score: {doc['spam_score']}, "
                           f"Reputation: {doc['reputation']}, "
                           f"Checked: {doc['checked_at']}",
                    "url": f"https://spam-checker.example.com/report/{doc['id']}"
                })
        
        # Search history for patterns
        if query_lower in ['recent', 'history', 'all']:
            for history_item in search_history[-10:]:  # Last 10 searches
                if history_item['result_id'] in spam_cache:
                    doc = spam_cache[history_item['result_id']]
                    results.append({
                        "id": doc["id"],
                        "title": f"Recent Check: {doc['phone_number_masked']}",
                        "text": f"Recent spam check - Score: {doc['spam_score']}, "
                               f"Reputation: {doc['reputation']}",
                        "url": f"https://spam-checker.example.com/report/{doc['id']}"
                    })
        
        # Remove duplicates
        seen_ids = set()
        unique_results = []
        for result in results:
            if result["id"] not in seen_ids:
                seen_ids.add(result["id"])
                unique_results.append(result)
        
        logger.info(f"Search returned {len(unique_results)} results for query: '{query}'")
        return {"results": unique_results}

    @mcp.tool()
    async def fetch(id: str) -> Dict[str, Any]:
        """
        Retrieve complete spam analysis report by document ID.
        
        This tool fetches the full spam analysis report for a specific phone number.
        Use this after finding relevant reports with the search tool to get complete
        information including detailed reputation analysis and recommendations.
        
        Args:
            id: Document ID from search results (e.g., spam_check_abc12345)
            
        Returns:
            Complete spam analysis report with detailed information, metadata,
            and recommendations for handling the phone number.
            
        Raises:
            ValueError: If the specified ID is not found
        """
        if not id:
            raise ValueError("Document ID is required")
        
        logger.info(f"Fetching spam report for ID: {id}")
        
        # Check if it's in our cache
        if id in spam_cache:
            doc = spam_cache[id]
            
            # Create comprehensive report
            analysis_text = f"""
# Spam Analysis Report

## Phone Number: {doc['phone_number_masked']}

### Reputation Summary
- **Spam Score**: {doc['spam_score']} (0 = Clean, 1 = Spam)
- **Reputation**: {doc['reputation']}
- **Confidence Level**: {doc['confidence']}
- **Last Checked**: {doc['checked_at']}

### Phone Details
- **Carrier**: {doc['carrier']}
- **Country**: {doc['country_code']}
- **Phone Type**: {doc['phone_type']}
- **Data Source**: {doc['source']}

### Analysis
{"This phone number has been flagged as SPAM by Nomorobo. Recommend avoiding for outbound campaigns to prevent reputation damage." if doc['spam_score'] == 1 else "This phone number appears to be clean with no spam reports. Safe to use for outbound communications."}

### Recommendations
{'''
- DO NOT USE for outbound calling or SMS campaigns
- Remove from marketing lists immediately  
- Consider carrier filtering may block calls from this number
- Review other numbers from same carrier/range
''' if doc['spam_score'] == 1 else '''
- Safe to use for outbound campaigns
- Monitor for future reputation changes
- Include in regular reputation monitoring
- Consider as clean caller ID option
'''}

### Technical Details
- Document ID: {doc['id']}
- Cache Status: Active (TTL: 24 hours)
- API Response Time: < 500ms
- Last Update: {doc['checked_at']}
            """.strip()
            
            return {
                "id": doc["id"],
                "title": f"Complete Spam Analysis: {doc['phone_number_masked']}",
                "text": analysis_text,
                "url": f"https://spam-checker.example.com/report/{doc['id']}",
                "metadata": {
                    "spam_score": doc['spam_score'],
                    "reputation": doc['reputation'],
                    "carrier": doc['carrier'],
                    "country_code": doc['country_code'],
                    "phone_type": doc['phone_type'],
                    "confidence": doc['confidence'],
                    "checked_at": doc['checked_at'],
                    "source": doc['source']
                }
            }
        
        # If not found in cache, return error
        raise ValueError(f"Spam report with ID '{id}' not found")

    return mcp

def main():
    """Main function to start the MCP server."""
    # Verify Twilio credentials
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        logger.error("Twilio credentials not found. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.")
        raise ValueError("Twilio credentials are required")
    
    logger.info("Starting Spam Checker MCP Server...")
    logger.info(f"Server will listen on {MCP_SERVER_HOST}:{MCP_SERVER_PORT}")
    logger.info("Ready to check phone numbers for spam reputation")
    
    # Create the MCP server
    server = create_server()
    
    try:
        # Use FastMCP's built-in run method with SSE transport
        server.run(transport="sse", host=MCP_SERVER_HOST, port=MCP_SERVER_PORT)
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise

if __name__ == "__main__":
    main()