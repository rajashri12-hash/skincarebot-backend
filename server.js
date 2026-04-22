import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { SessionsClient } from "@google-cloud/dialogflow";
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

console.log("Starting Dialogflow server...");

function unwrapProtoValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "numberValue")) return value.numberValue;
  if (Object.prototype.hasOwnProperty.call(value, "boolValue")) return value.boolValue;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;

  if (Object.prototype.hasOwnProperty.call(value, "listValue")) {
    const list = value.listValue?.values || [];
    return list.map(unwrapProtoValue);
  }

  if (Object.prototype.hasOwnProperty.call(value, "structValue")) {
    const fields = value.structValue?.fields || {};
    const out = {};
    Object.entries(fields).forEach(([k, v]) => {
      out[k] = unwrapProtoValue(v);
    });
    return out;
  }

  if (Array.isArray(value)) return value.map(unwrapProtoValue);

  const out = {};
  Object.entries(value).forEach(([k, v]) => {
    out[k] = unwrapProtoValue(v);
  });
  return out;
}

function pickFirstString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = pickFirstString(item);
      if (candidate) return candidate;
    }
    return "";
  }

  if (value && typeof value === "object") {
    if (typeof value.text === "string") return pickFirstString(value.text);
    if (Array.isArray(value.text)) return pickFirstString(value.text);
    if (typeof value.message === "string") return pickFirstString(value.message);
  }

  return "";
}

function extractTextFromPayload(payload) {
  const normalized = unwrapProtoValue(payload);
  const preferredKeys = ["fulfillmentText", "textToSpeech", "displayText", "speech", "text", "message"];

  function dfs(node) {
    if (node === null || node === undefined) return "";

    if (typeof node === "string") return pickFirstString(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const candidate = dfs(item);
        if (candidate) return candidate;
      }
      return "";
    }

    if (typeof node === "object") {
      for (const key of preferredKeys) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          const candidate = pickFirstString(node[key]);
          if (candidate) return candidate;
        }
      }

      for (const value of Object.values(node)) {
        const candidate = dfs(value);
        if (candidate) return candidate;
      }
    }

    return "";
  }

  return dfs(normalized);
}

function sanitizeSessionId(rawSessionId) {
  const value = String(rawSessionId || '').trim();
  if (!value) return '';
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

const app = express();
app.use(bodyParser.json());
app.use(cors()); // allow requests from your React frontend
// Serve static UI from the `public/` folder
app.use(express.static('public'));

const sessionByClient = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve index.html at root for the SPA
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize Dialogflow client
let client;
try {
  if (process.env.DIALOGFLOW_CLIENT_EMAIL && process.env.DIALOGFLOW_PRIVATE_KEY) {
    // Render / Production: use environment variables
    client = new SessionsClient({
      credentials: {
        client_email: process.env.DIALOGFLOW_CLIENT_EMAIL,
        private_key: process.env.DIALOGFLOW_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      projectId: process.env.DIALOGFLOW_PROJECT_ID,
    });
    console.log("Dialogflow client initialized with environment variables.");
  } else {
    // Local development: use JSON file
    client = new SessionsClient({
      keyFilename: "skincarebot-vefg-e0c6339d8134.json",
    });
    console.log("Dialogflow client initialized with local JSON file.");
  }
} catch (err) {
  console.error("Failed to initialize Dialogflow client:", err);
  process.exit(1);
}

app.post("/api/dialogflow", async (req, res) => {
  const { text, sessionId: incomingSessionId } = req.body || {};
  console.log("Received text:", text);

  const clientKey = (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  const mappedSessionId = clientKey ? sessionByClient.get(clientKey) : '';

  const stableSessionId =
    sanitizeSessionId(incomingSessionId) ||
    sanitizeSessionId(req.get('x-session-id')) ||
    sanitizeSessionId(mappedSessionId) ||
    `web-${randomUUID()}`;

  if (clientKey && !sessionByClient.has(clientKey)) {
    sessionByClient.set(clientKey, stableSessionId);
  }

  const sessionPath = client.projectAgentSessionPath(
    process.env.DIALOGFLOW_PROJECT_ID || "skincarebot-vefg",
    stableSessionId
  );

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text,
        languageCode: "en", // safer default
      },
    },
  };

  try {
    const responses = await client.detectIntent(request);
    const result = responses[0].queryResult;

    const fallbackReply = "I understood your input but have no text response configured for this intent.";
    let reply = (result.fulfillmentText || "").trim();
    let suggestions = [];
    let links = [];

    if (result.fulfillmentMessages) {
      result.fulfillmentMessages.forEach(msg => {
        if (!reply && msg.text && Array.isArray(msg.text.text) && msg.text.text.length > 0) {
          const firstText = msg.text.text.find(t => typeof t === "string" && t.trim().length > 0);
          if (firstText) reply = firstText.trim();
        }

        if (!reply && msg.simpleResponses && Array.isArray(msg.simpleResponses.simpleResponses) && msg.simpleResponses.simpleResponses.length > 0) {
          const firstSimple = msg.simpleResponses.simpleResponses[0];
          const simpleText = (firstSimple.textToSpeech || firstSimple.displayText || "").trim();
          if (simpleText) reply = simpleText;
        }

        if (!reply && msg.payload) {
          const payloadReply = extractTextFromPayload(msg.payload);
          if (payloadReply) reply = payloadReply;
        }

        if (msg.suggestions && msg.suggestions.suggestions) {
          msg.suggestions.suggestions.forEach(opt => {
            if (opt.title) suggestions.push(opt.title);
          });
        }
        if (msg.linkOutSuggestion) {
          links.push({
            name: msg.linkOutSuggestion.destinationName,
            url: msg.linkOutSuggestion.uri
          });
        }
      });
    }

    if (!reply) {
      reply = fallbackReply;
    }

    console.log("Reply:", reply);
    console.log("Suggestions:", suggestions);
    console.log("Links:", links);

    res.json({ reply, suggestions, links, sessionId: stableSessionId });
  } catch (err) {
    console.error("Dialogflow error:", err); // log full error
    res.status(500).json({ reply: "Error contacting Dialogflow.", sessionId: stableSessionId });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});