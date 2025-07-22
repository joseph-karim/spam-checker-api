/**
 * Spam Checker MCP Server - Proper SSE Implementation for ChatGPT
 */

// Utility functions
function maskPhoneNumber(phone) {
  if (phone.length < 4) return '*'.repeat(phone.length);
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

function isE164(number) {
  return number.startsWith('+') && /^\+\d{10,15}$/.test(number);
}

function createDocumentId(phone) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) {
    const char = phone.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `spam_check_${Math.abs(hash).toString(16).slice(0, 8)}`;
}

// Check spam score using Twilio API
async function checkSpamScore(phoneNumber, env) {
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

  if (!response.ok) {
    throw new Error(`Twilio API error: ${response.status}`);
  }

  const data = await response.json();
  const nomoroboResult = data.add_ons?.results?.nomorobo_spamscore;
  const score = nomoroboResult?.result?.score ?? 0;

  return {
    id: createDocumentId(phoneNumber),
    phone_number_masked: maskPhoneNumber(phoneNumber),
    spam_score: score,
    reputation: score === 1 ? 'SPAM' : 'CLEAN',
    checked_at: new Date().toISOString()
  };
}

// MCP message handlers
const handlers = {
  async initialize(params, id) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          prompts: {}
        },
        serverInfo: {
          name: 'Spam Checker MCP Server',
          version: '1.0.0'
        }
      }
    };
  },

  async 'tools/list'(params, id) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'search',
            description: 'Search for spam reports on phone numbers',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Phone number to check (E.164 format like +12345678901)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'fetch',
            description: 'Fetch detailed spam report by ID',
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
    };
  },

  async 'tools/call'(params, id, env) {
    const { name, arguments: args } = params;

    if (name === 'search') {
      const query = args?.query;
      if (!query) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            results: []
          }
        };
      }

      // Check if it's a phone number
      if (query.startsWith('+') || /^\d{10,}$/.test(query)) {
        try {
          // Ensure proper E.164 format
          const phoneNumber = query.startsWith('+') ? query : '+1' + query;
          const spamResult = await checkSpamScore(phoneNumber, env);
          
          return {
            jsonrpc: '2.0',
            id,
            result: {
              results: [{
                id: spamResult.id,
                title: `Spam Check: ${spamResult.phone_number_masked}`,
                text: `Phone: ${spamResult.phone_number_masked}, Score: ${spamResult.spam_score}, Reputation: ${spamResult.reputation}`,
                url: `https://spam-checker.example.com/report/${spamResult.id}`
              }]
            }
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              results: [{
                id: `error_${Date.now()}`,
                title: 'Error checking number',
                text: `Could not check spam status: ${error.message}`,
                url: 'https://spam-checker.example.com/error'
              }]
            }
          };
        }
      }

      // Not a phone number query
      return {
        jsonrpc: '2.0',
        id,
        result: {
          results: []
        }
      };
    }

    if (name === 'fetch') {
      const docId = args?.id;
      if (!docId) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Document ID is required'
          }
        };
      }

      // Return a message indicating real-time lookup
      return {
        jsonrpc: '2.0',
        id,
        result: {
          id: docId,
          title: 'Real-time Spam Check Service',
          text: 'This service provides real-time spam checks. Use the search tool with a phone number to get current spam status.',
          url: 'https://spam-checker.example.com',
          metadata: {
            service: 'Twilio Lookup + Nomorobo',
            type: 'real-time'
          }
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unknown tool: ${name}`
      }
    };
  }
};

// Main worker handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Allow-Credentials': 'true'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // SSE endpoint - this is what ChatGPT uses
    if (url.pathname === '/sse' || url.pathname === '/sse/') {
      // ChatGPT sends messages via POST to SSE endpoint
      if (request.method === 'POST') {
        try {
          const message = await request.json();
          const { method, params, id } = message;
          
          let response;
          if (handlers[method]) {
            response = await handlers[method](params, id, env);
          } else {
            response = {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Method not found: ${method}`
              }
            };
          }

          // Return SSE formatted response
          const sseResponse = `data: ${JSON.stringify(response)}\n\n`;
          
          return new Response(sseResponse, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache'
            }
          });
        } catch (error) {
          const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: 'Parse error: ' + error.message
            }
          };
          
          return new Response(`data: ${JSON.stringify(errorResponse)}\n\n`, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache'
            }
          });
        }
      }
      
      // GET request to SSE endpoint - return keep-alive stream
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(':ok\n\n'));
          
          // Keep connection alive
          const interval = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(':keepalive\n\n'));
            } catch (e) {
              clearInterval(interval);
            }
          }, 30000);
          
          // Clean up on close
          ctx.waitUntil(
            new Promise((resolve) => {
              setTimeout(() => {
                clearInterval(interval);
                resolve();
              }, 300000); // 5 minutes max
            })
          );
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    // Regular JSON-RPC endpoint (backward compatibility)
    if (url.pathname === '/mcp' && request.method === 'POST') {
      try {
        const message = await request.json();
        const { method, params, id } = message;
        
        let response;
        if (handlers[method]) {
          response = await handlers[method](params, id, env);
        } else {
          response = {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`
            }
          };
        }
        
        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: `Internal error: ${error.message}`
          }
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        service: 'Spam Checker MCP Server',
        endpoints: {
          sse: '/sse (ChatGPT Deep Research)',
          jsonrpc: '/mcp (Standard JSON-RPC)'
        },
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Default response
    return new Response('Spam Checker MCP Server\n\nEndpoints:\n- /sse - For ChatGPT Deep Research\n- /mcp - For JSON-RPC clients\n- /health - Health check', {
      headers: corsHeaders
    });
  }
};