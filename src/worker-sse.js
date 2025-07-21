/**
 * Spam Checker MCP Server with SSE (Server-Sent Events) for ChatGPT
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

// Format SSE message
function formatSSE(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Handle MCP protocol messages
async function handleMCPMessage(message, env) {
  const { method, params, id } = message;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
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
      };

    case 'tools/list':
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
                    description: 'Phone number to check (E.164 format)'
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

    case 'tools/call':
      if (params.name === 'search') {
        const query = params.arguments?.query;
        if (!query) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({ results: [] })
              }]
            }
          };
        }

        try {
          const spamResult = await checkSpamScore(query, env);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  results: [{
                    id: spamResult.id,
                    title: `Spam Check: ${spamResult.phone_number_masked}`,
                    text: `Phone: ${spamResult.phone_number_masked}, Score: ${spamResult.spam_score}, Reputation: ${spamResult.reputation}`,
                    url: `https://spam-checker.example.com/report/${spamResult.id}`
                  }]
                })
              }]
            }
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  results: [{
                    id: `error_${Date.now()}`,
                    title: 'Error checking number',
                    text: error.message,
                    url: 'https://spam-checker.example.com/error'
                  }]
                })
              }]
            }
          };
        }
      }

      if (params.name === 'fetch') {
        // For now, return a message to use search instead
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                id: params.arguments?.id,
                title: 'Use search for real-time data',
                text: 'This service provides real-time spam checks. Please use the search tool with a phone number.',
                url: 'https://spam-checker.example.com'
              })
            }]
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${params.name}`
        }
      };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown method: ${method}`
        }
      };
  }
}

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

    // SSE endpoint for MCP
    if (url.pathname === '/sse' || url.pathname === '/sse/') {
      // Create SSE response
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Send SSE headers
      const headers = {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      };

      // Handle incoming messages
      const handleRequest = async () => {
        try {
          // Send initial connection message
          await writer.write(encoder.encode(':ok\n\n'));

          // Read incoming messages
          const reader = request.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim() && line.startsWith('data: ')) {
                  try {
                    const message = JSON.parse(line.slice(6));
                    const response = await handleMCPMessage(message, env);
                    await writer.write(encoder.encode(formatSSE(response)));
                  } catch (e) {
                    const errorResponse = {
                      jsonrpc: '2.0',
                      id: null,
                      error: {
                        code: -32700,
                        message: 'Parse error'
                      }
                    };
                    await writer.write(encoder.encode(formatSSE(errorResponse)));
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('SSE error:', error);
        } finally {
          await writer.close();
        }
      };

      // Start handling in background
      ctx.waitUntil(handleRequest());

      return new Response(readable, { headers });
    }

    // Regular JSON-RPC endpoint (keep for backward compatibility)
    if (url.pathname === '/mcp' && request.method === 'POST') {
      try {
        const message = await request.json();
        const response = await handleMCPMessage(message, env);
        
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
        service: 'Spam Checker MCP Server (SSE)',
        endpoints: ['/sse', '/mcp'],
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Default response
    return new Response('Spam Checker MCP Server - use /sse for ChatGPT or /mcp for JSON-RPC', {
      headers: corsHeaders
    });
  }
};