import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { config } from 'dotenv';
import fs from "fs";
import path from "path";
import sanitize from "sanitize-filename";
import { PhoneNumberIdentifier } from "@azure/communication-common";

import {
  CallAutomationClient,
  CallConnection,
  CallMedia,
  CreateCallOptions,
  CallInvite,
  CallMediaRecognizeChoiceOptions,
  RecognitionChoice,
  TextSource,
  DtmfTone
} from "@azure/communication-call-automation";

// Load .env locally, but in Azure you use the Function's Application Settings
config();

// Global variables (caveat: Azure Functions can be ephemeral so do not rely on these in production)
let callConnectionId: string;
let callConnection: CallConnection;
let serverCallId: string;
let callee: PhoneNumberIdentifier;
let acsClient: CallAutomationClient;
let shouldHangUpAfterNextPrompt = false;
let nextPromptContext: string | null = null;

// Predefined prompts/messages
const mainMenu = `Hello, this is an automated Visit Qatar Concierge calling on behalf of Sheikh Ali...
Please say confirm to proceed with the reservation, or say cancel if you need to cancel.`;
const softPrompt = `When you're ready, please say confirm or cancel.`;
const confirmText = `Thank you for confirming the reservation...`;
const cancelText = `The reservation has been cancelled...`;
const customerQueryTimeout = `I didn’t catch that — let’s try one more time.`;
const noResponse = `No response detected. We’ll proceed with confirming the reservation. Thank you.`;
const invalidAudio = `I’m sorry, we couldn’t understand your response. Let’s try again.`;

const confirmLabel = `Confirm`;
const cancelLabel = `Cancel`;
const waitLabel = `Wait`;
const retryContext = `Retry`;

console.log("Starting OutboundCallFunction...");
console.log("Environment variables loaded.");

async function createAcsClient(): Promise<void> {
  if (!acsClient) {
    const connectionString = process.env.CONNECTION_STRING || "";
    acsClient = new CallAutomationClient(connectionString);
    console.log("Initialized ACS Client.");
  }
}

async function createOutboundCall(): Promise<void> {
  const callInvite: CallInvite = {
    targetParticipant: callee,
    sourceCallIdNumber: {
      phoneNumber: process.env.ACS_RESOURCE_PHONE_NUMBER || "",
    },
  };

  const options: CreateCallOptions = {
    callIntelligenceOptions: {
      cognitiveServicesEndpoint: process.env.COGNITIVE_SERVICES_ENDPOINT
    }
  };

  console.log("Placing outbound call...");
  await acsClient.createCall(
    callInvite,
    // This callback route must match how ACS is configured to POST events back here
    (process.env.CALLBACK_URI || "") + "/api/callbacks",
    options
  );
}

async function handlePlay(callConnectionMedia: CallMedia, textContent: string, hangUpAfter: boolean = false) {
  const play: TextSource = {
    text: textContent,
    voiceName: "en-US-AvaMultilingualNeural",
    kind: "textSource"
  };

  shouldHangUpAfterNextPrompt = hangUpAfter;
  await callConnectionMedia.playToAll([play]);
}

async function getChoices(): Promise<RecognitionChoice[]> {
  return [
    {
      label: confirmLabel,
      phrases: ["Confirm", "First", "One"],
      tone: DtmfTone.One
    },
    {
      label: cancelLabel,
      phrases: ["Cancel", "Second", "Two"],
      tone: DtmfTone.Two
    },
    {
      label: waitLabel,
      phrases: [
        "One second",
        "Just a second",
        "Give me a moment",
        "Hold on",
        "Wait",
        "Wait please",
        "Just a moment",
        "Hang on",
        "Please wait"
      ],
      tone: DtmfTone.Three
    }
  ];
}

async function startRecognizing(callMedia: CallMedia, textToPlay: string, context: string) {
  const playSource: TextSource = {
    text: textToPlay,
    voiceName: "en-US-NancyNeural",
    kind: "textSource"
  };

  const recognizeOptions: CallMediaRecognizeChoiceOptions = {
    choices: await getChoices(),
    interruptPrompt: false,
    initialSilenceTimeoutInSeconds: 10,
    playPrompt: playSource,
    operationContext: context,
    speechLanguage: "en-US",
    kind: "callMediaRecognizeChoiceOptions"
  };

  await callMedia.startRecognizing(callee, recognizeOptions);
}

async function hangUpCall() {
  await callConnection.hangUp(true);
}

/**
 * The main Azure Function entry point.
 * We handle all routes here by checking req.method, and the path from bindingData.segments.
 */
const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  // Make sure ACS client is initialized
  await createAcsClient();

  const segments = (context.bindingData.segments || "").split("/").filter((s: string) => s);

  // For quick debugging:
  // context.log(`Method: ${req.method}, Segments: ${segments}, Full URL: ${req.url}`);

  // 1) Handle GET / => Return index.html
  if (req.method === "GET" && segments.length === 0) {
    try {
      const filePath = path.join(__dirname, "../webpage/index.html");
      const htmlContent = fs.readFileSync(filePath, "utf8");
      context.res = {
        status: 200,
        headers: { "Content-Type": "text/html" },
        body: htmlContent
      };
      return;
    } catch (err) {
      context.log("Error reading index.html:", err);
      context.res = { status: 500, body: "Error loading page." };
      return;
    }
  }

  // 2) Handle GET /outboundCall => Place an outbound call and redirect to '/'
  if (req.method === "GET" && segments[0] === "outboundCall") {
    // Set the callee from environment
    callee = {
      phoneNumber: process.env.TARGET_PHONE_NUMBER || ""
    };

    await createOutboundCall();
    // Return a redirect to root page
    context.res = {
      status: 302,
      headers: { location: "/" }
    };
    return;
  }

  // 3) Handle POST /api/callbacks => ACS event callbacks
  if (req.method === "POST" && segments[0] === "api" && segments[1] === "callbacks") {
    const event = req.body[0];
    const eventData = event.data;

    callConnectionId = eventData.callConnectionId;
    serverCallId = eventData.serverCallId;

    context.log(
      "Callback event: callConnectionId=%s, serverCallId=%s, eventType=%s",
      callConnectionId, serverCallId, event.type
    );

    callConnection = acsClient.getCallConnection(callConnectionId);
    const callMedia = callConnection.getCallMedia();

    if (event.type === "Microsoft.Communication.CallConnected") {
      context.log("Received CallConnected event");
      await startRecognizing(callMedia, mainMenu, "");
    } 
    else if (event.type === "Microsoft.Communication.RecognizeCompleted") {
      if (eventData.recognitionType === "choices") {
        const contextVal = eventData.operationContext;
        const labelDetected = eventData.choiceResult.label;
        const phraseDetected = eventData.choiceResult.recognizedPhrase;

        context.log(
          "Recognition completed, labelDetected=%s, phraseDetected=%s, context=%s",
          labelDetected, phraseDetected, contextVal
        );

        if (labelDetected === confirmLabel) {
          await handlePlay(callMedia, confirmText, true);
        } else if (labelDetected === cancelLabel) {
          await handlePlay(callMedia, cancelText, true);
        } else if (labelDetected === waitLabel) {
          nextPromptContext = "waitFollowup";
          await handlePlay(callMedia, "No worries, take your time.");
        }
      }
    }
    else if (event.type === "Microsoft.Communication.RecognizeFailed") {
      const contextVal = eventData.operationContext;
      const resultInformation = eventData.resultInformation;
      const code = resultInformation?.subCode;

      context.log("Recognize failed: data=%s", JSON.stringify(eventData, null, 2));

      let replyText = "";
      switch (code) {
        case 8510:
        case 8511:
          replyText = customerQueryTimeout;
          break;
        case 8534:
        case 8547:
          replyText = invalidAudio;
          break;
        default:
          replyText = customerQueryTimeout;
      }

      if (contextVal && contextVal === retryContext) {
        await handlePlay(callMedia, noResponse, true);
      } else {
        await startRecognizing(callMedia, replyText, retryContext);
      }
    }
    else if (
      event.type === "Microsoft.Communication.PlayCompleted" ||
      event.type === "Microsoft.Communication.playFailed"
    ) {
      if (shouldHangUpAfterNextPrompt) {
        context.log("Terminating call.");
        await hangUpCall();
      } else if (nextPromptContext === "waitFollowup") {
        nextPromptContext = null;
        context.log("Wait response complete — now soft re-prompting...");
        await startRecognizing(callConnection.getCallMedia(), softPrompt, retryContext);
      } else {
        context.log("Play completed, continuing...");
      }
    }

    context.res = { status: 200 };
    return;
  }

  // 4) Handle GET /audioprompt/:filename => Serve WAV file
  if (req.method === "GET" && segments[0] === "audioprompt") {
    const filename = segments[1];
    if (!filename) {
      context.res = { status: 400, body: "Filename missing" };
      return;
    }

    const sanitizedFilename = sanitize(filename);
    try {
      const baseMediaPath = process.env.BASE_MEDIA_PATH || "";
      const audioFilePath = fs.realpathSync(path.join(baseMediaPath, sanitizedFilename));
      const fileData = fs.readFileSync(audioFilePath);

      context.res = {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": fileData.length,
          "Cache-Control": "no-cache, no-store",
          "Pragma": "no-cache"
        },
        body: fileData
      };
      return;
    } catch (err) {
      context.log("Failed to find audio file:", err);
      context.res = { status: 500, body: "Internal Server Error" };
      return;
    }
  }

  // If nothing matched, return 404
  context.res = {
    status: 404,
    body: `No route matched for segments: [${segments.join("/")}]`
  };
};

export default httpTrigger;
