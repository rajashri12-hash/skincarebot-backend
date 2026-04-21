import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { SessionsClient } from "@google-cloud/dialogflow";

console.log("Starting Dialogflow server...");

const app = express();
app.use(bodyParser.json());
app.use(cors()); // allow requests from your React frontend

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
  const { text } = req.body;
  console.log("Received text:", text);

  const sessionPath = client.projectAgentSessionPath(
    process.env.DIALOGFLOW_PROJECT_ID || "skincarebot-vefg",
    "session-" + Date.now()
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

    let reply = result.fulfillmentText || "";
    let suggestions = [];
    let links = [];

    if (result.fulfillmentMessages) {
      result.fulfillmentMessages.forEach(msg => {
        if (msg.text && msg.text.text.length > 0) {
          reply = msg.text.text[0];
        }
        if (msg.simpleResponses && msg.simpleResponses.simpleResponses.length > 0) {
          reply = msg.simpleResponses.simpleResponses[0].textToSpeech;
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

    console.log("Reply:", reply);
    console.log("Suggestions:", suggestions);
    console.log("Links:", links);

    res.json({ reply, suggestions, links });
  } catch (err) {
    console.error("Dialogflow error:", err); // log full error
    res.status(500).json({ reply: "Error contacting Dialogflow." });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});