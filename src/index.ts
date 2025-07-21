/**
 * Spam Checker MCP Server for Cloudflare Workers
 * Based on official Cloudflare MCP server guide
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for MCP
app.use('*', cors());

// Types for MCP protocol
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface SpamCheckResult {
  id: string;
  phone_number_masked: string;
  spam_score: number;
  reputation: string;
  carrier: string;
  country_code: string;
  phone_type: string;
  checked_at: string;
  source: string;
  confidence: string;
}

// Utility functions
function maskPhoneNumber(phone: string): string {
  if (phone.length < 4) return '*'.repeat(phone.length);
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

function isE164(number: string): boolean {
  return number.startsWith('+') && /^\+\d{10,15}$/.test(number);
}

function createDocumentId(phone: string): string {
  // Simple hash function for document ID
  let hash = 0;
  for (let i = 0; i < phone.length; i++) {
    const char = phone.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `spam_check_${Math.abs(hash).toString(16).slice(0, 8)}`;
}

// Check spam score using Twilio Lookup API
async function checkSpamScore(phoneNumber: string, env: Bindings): Promise<SpamCheckResult> {
  if (!isE164(phoneNumber)) {
    throw new Error(`Invalid phone number format: ${phoneNumber}`);
  }

  const url = `https://lookups.twilio.com/v1/PhoneNumbers/${phoneNumber}?AddOns=nomorobo_spamscore`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)
    }
  });

  if (response.status === 404) {
    throw new Error(`Phone number not found: ${phoneNumber}`);
  }
  if (response.status === 401) {
    throw new Error('Twilio authentication failed');
  }
  if (response.status === 429) {
    throw new Error('Twilio rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`Twilio API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Parse Nomorobo score
  const addOns = data.add_ons || {};
  const results = addOns.results || {};
  const nomorobo = results.nomorobo_spamscore || {};
  const result = nomorobo.result || {};
  const score = result.score ?? 0;

  return {
    id: createDocumentId(phoneNumber),
    phone_number_masked: maskPhoneNumber(phoneNumber),
    spam_score: score,
    reputation: score === 1 ? 'SPAM' : 'CLEAN',
    carrier: data.carrier?.name || 'Unknown',
    country_code: data.country_code || 'Unknown',
    phone_type: data.type || 'Unknown',
    checked_at: new Date().toISOString(),
    source: 'Twilio Lookup API + Nomorobo',
    confidence: score in [0, 1] ? 'High' : 'Low'
  };
}

// MCP Server Implementation
app.post('/mcp', async (c) => {
  const request: MCPRequest = await c.req.json();

  try {
    switch (request.method) {
      case 'initialize':
        return c.json({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'Spam Checker MCP Server',
              version: '1.0.0'
            }
          }
        });

      case 'tools/list':
        return c.json({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: [
              {
                name: 'search',
                description: 'Search for spam reports based on phone numbers or keywords',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'Search query - phone number (E.164 format) or keywords'
                    }
                  },
                  required: ['query']
                }
              },
              {
                name: 'fetch',
                description: 'Retrieve complete spam analysis report by document ID',
                inputSchema: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Document ID from search results'
                    }
                  },
                  required: ['id']
                }
              }
            ]
          }
        });

      case 'tools/call':
        const { name, arguments: args } = request.params;
        
        if (name === 'search') {
          const query = args.query?.trim();
          if (!query) {
            return c.json({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ results: [] })
                }]
              }
            });
          }

          // If query looks like a phone number, check it directly
          if (query.startsWith('+') && query.length > 5) {
            try {
              const spamResult = await checkSpamScore(query, c.env);
              const results = [{
                id: spamResult.id,
                title: `Spam Check: ${spamResult.phone_number_masked}`,
                text: `Phone: ${spamResult.phone_number_masked}, Score: ${spamResult.spam_score}, Reputation: ${spamResult.reputation}, Carrier: ${spamResult.carrier}`,
                url: `https://spam-checker.example.com/report/${spamResult.id}`
              }];
              
              return c.json({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({ results })
                  }]
                }
              });
            } catch (error) {
              const errorResults = [{
                id: `error_${Date.now()}`,
                title: `Error checking ${maskPhoneNumber(query)}`,
                text: `Could not check spam status: ${error.message}`,
                url: 'https://spam-checker.example.com/error'
              }];
              
              return c.json({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({ results: errorResults })
                  }]
                }
              });
            }
          }

          // For non-phone queries, return empty results (could be enhanced with database)
          return c.json({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({ results: [] })
              }]
            }
          });
        }

        if (name === 'fetch') {
          const id = args.id;
          if (!id) {
            return c.json({
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32602,
                message: 'Document ID is required'
              }
            });
          }

          // For demo purposes, we'll try to extract phone number from ID and re-check
          // In production, you'd store this in a database
          return c.json({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'Document retrieval requires phone number re-check. Use search instead.'
                })
              }]
            }
          });
        }

        return c.json({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`
          }
        });

      default:
        return c.json({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Unknown method: ${request.method}`
          }
        });
    }
  } catch (error) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      }
    });
  }
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'Spam Checker MCP Server' });
});

export default app;