/**
 * Spam Checker MCP Server for Cloudflare Workers with Twilio SDK
 */

import twilio from 'twilio';

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

// Check spam score using Twilio SDK
async function checkSpamScore(phoneNumber, env) {
  if (!isE164(phoneNumber)) {
    throw new Error(`Invalid phone number format: ${phoneNumber}`);
  }

  // Initialize Twilio client
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

  // Prepare options for Twilio Lookup API
  const lookupOptions = {
    addOns: env.NOMOROBO_ADDON_SID
  };

  try {
    // Call Twilio Lookup API with Nomorobo Spam Score Add-on
    const phoneNumberLookup = await client.lookups.v1
      .phoneNumbers(phoneNumber)
      .fetch(lookupOptions);

    // Get the results using the Add-on SID
    const nomoroboResult = phoneNumberLookup.addOns?.results?.[env.NOMOROBO_ADDON_SID];

    if (!nomoroboResult || nomoroboResult.status !== 'successful') {
      throw new Error('Failed to retrieve spam score from Nomorobo');
    }

    const score = nomoroboResult.result?.score ?? 0;

    return {
      id: createDocumentId(phoneNumber),
      phone_number_masked: maskPhoneNumber(phoneNumber),
      spam_score: score,
      reputation: score === 1 ? 'SPAM' : 'CLEAN',
      carrier: phoneNumberLookup.carrier?.name || 'Unknown',
      country_code: phoneNumberLookup.country_code || 'Unknown',
      phone_type: phoneNumberLookup.carrier?.type || 'Unknown',
      checked_at: new Date().toISOString(),
      source: 'Twilio Lookup API + Nomorobo',
      confidence: [0, 1].includes(score) ? 'High' : 'Low'
    };
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`Phone number not found: ${phoneNumber}`);
    }
    if (error.status === 401) {
      throw new Error('Twilio authentication failed');
    }
    if (error.status === 429) {
      throw new Error('Twilio rate limit exceeded');
    }
    throw error;
  }
}

// MCP Protocol handlers
async function handleInitialize(request) {
  return {
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
  };
}

async function handleToolsList(request) {
  return {
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
  };
}

async function handleToolCall(request, env) {
  const { name, arguments: args } = request.params;
  
  if (name === 'search') {
    const query = args.query?.trim();
    if (!query) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ results: [] })
          }]
        }
      };
    }

    // If query looks like a phone number, check it directly
    if (query.startsWith('+') && query.length > 5) {
      try {
        const spamResult = await checkSpamScore(query, env);
        const results = [{
          id: spamResult.id,
          title: `Spam Check: ${spamResult.phone_number_masked}`,
          text: `Phone: ${spamResult.phone_number_masked}, Score: ${spamResult.spam_score}, Reputation: ${spamResult.reputation}, Carrier: ${spamResult.carrier}`,
          url: `https://spam-checker.example.com/report/${spamResult.id}`
        }];
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ results })
            }]
          }
        };
      } catch (error) {
        const errorResults = [{
          id: `error_${Date.now()}`,
          title: `Error checking ${maskPhoneNumber(query)}`,
          text: `Could not check spam status: ${error.message}`,
          url: 'https://spam-checker.example.com/error'
        }];
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ results: errorResults })
            }]
          }
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({ results: [] })
        }]
      }
    };
  }

  if (name === 'fetch') {
    const id = args.id;
    if (!id) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32602,
          message: 'Document ID is required'
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Document retrieval requires phone number re-check. Use search instead.'
          })
        }]
      }
    };
  }

  return {
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32601,
      message: `Unknown tool: ${name}`
    }
  };
}

// Main worker handler
export default {
  async fetch(request, env, ctx) {
    // Enable CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        service: 'Spam Checker MCP Server (SDK)',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // MCP endpoint
    if (url.pathname === '/mcp' && request.method === 'POST') {
      try {
        const mcpRequest = await request.json();
        let response;

        switch (mcpRequest.method) {
          case 'initialize':
            response = await handleInitialize(mcpRequest);
            break;
          case 'tools/list':
            response = await handleToolsList(mcpRequest);
            break;
          case 'tools/call':
            response = await handleToolCall(mcpRequest, env);
            break;
          default:
            response = {
              jsonrpc: '2.0',
              id: mcpRequest.id,
              error: {
                code: -32601,
                message: `Unknown method: ${mcpRequest.method}`
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

    // Default response
    return new Response('Spam Checker MCP Server - use /mcp endpoint', {
      headers: corsHeaders
    });
  }
};