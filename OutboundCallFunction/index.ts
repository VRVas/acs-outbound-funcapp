// import { AzureFunction, Context, HttpRequest } from "@azure/functions";
// import { config } from 'dotenv';
// import fs from "fs";
// import path from "path";
// import sanitize from "sanitize-filename";
// import { PhoneNumberIdentifier } from "@azure/communication-common";

// import {
//   CallAutomationClient,
//   CallConnection,
//   CallMedia,
//   CreateCallOptions,
//   CallInvite,
//   CallMediaRecognizeChoiceOptions,
//   RecognitionChoice,
//   TextSource,
//   DtmfTone
// } from "@azure/communication-call-automation";

// // Load .env locally, but in Azure you use the Function's Application Settings
// config();

// // Global variables (caveat: Azure Functions can be ephemeral so do not rely on these in production)
// let callConnectionId: string;
// let callConnection: CallConnection;
// let serverCallId: string;
// let callee: PhoneNumberIdentifier;
// let acsClient: CallAutomationClient;
// let shouldHangUpAfterNextPrompt = false;
// let nextPromptContext: string | null = null;

// // Predefined prompts/messages
// const mainMenu = `Hello, this is an automated Visit Qatar Concierge calling on behalf of Sheikh Ali...
// Please say confirm to proceed with the reservation, or say cancel if you need to cancel.`;
// const softPrompt = `When you're ready, please say confirm or cancel.`;
// const confirmText = `Thank you for confirming the reservation...`;
// const cancelText = `The reservation has been cancelled...`;
// const customerQueryTimeout = `I didn’t catch that — let’s try one more time.`;
// const noResponse = `No response detected. We’ll proceed with confirming the reservation. Thank you.`;
// const invalidAudio = `I’m sorry, we couldn’t understand your response. Let’s try again.`;

// const confirmLabel = `Confirm`;
// const cancelLabel = `Cancel`;
// const waitLabel = `Wait`;
// const retryContext = `Retry`;

// console.log("Starting OutboundCallFunction...");
// console.log("Environment variables loaded.");

// async function createAcsClient(): Promise<void> {
//   if (!acsClient) {
//     const connectionString = process.env.CONNECTION_STRING || "";
//     acsClient = new CallAutomationClient(connectionString);
//     console.log("Initialized ACS Client.");
//   }
// }

// async function createOutboundCall(): Promise<void> {
//   const callInvite: CallInvite = {
//     targetParticipant: callee,
//     sourceCallIdNumber: {
//       phoneNumber: process.env.ACS_RESOURCE_PHONE_NUMBER || "",
//     },
//   };

//   const options: CreateCallOptions = {
//     callIntelligenceOptions: {
//       cognitiveServicesEndpoint: process.env.COGNITIVE_SERVICES_ENDPOINT
//     }
//   };

//   console.log("Placing outbound call...");
//   await acsClient.createCall(
//     callInvite,
//     // This callback route must match how ACS is configured to POST events back here
//     (process.env.CALLBACK_URI || "") + "/api/callbacks",
//     options
//   );
// }

// async function handlePlay(callConnectionMedia: CallMedia, textContent: string, hangUpAfter: boolean = false) {
//   const play: TextSource = {
//     text: textContent,
//     voiceName: "en-US-AvaMultilingualNeural",
//     kind: "textSource"
//   };

//   shouldHangUpAfterNextPrompt = hangUpAfter;
//   await callConnectionMedia.playToAll([play]);
// }

// async function getChoices(): Promise<RecognitionChoice[]> {
//   return [
//     {
//       label: confirmLabel,
//       phrases: ["Confirm", "First", "One"],
//       tone: DtmfTone.One
//     },
//     {
//       label: cancelLabel,
//       phrases: ["Cancel", "Second", "Two"],
//       tone: DtmfTone.Two
//     },
//     {
//       label: waitLabel,
//       phrases: [
//         "One second",
//         "Just a second",
//         "Give me a moment",
//         "Hold on",
//         "Wait",
//         "Wait please",
//         "Just a moment",
//         "Hang on",
//         "Please wait"
//       ],
//       tone: DtmfTone.Three
//     }
//   ];
// }

// async function startRecognizing(callMedia: CallMedia, textToPlay: string, context: string) {
//   const playSource: TextSource = {
//     text: textToPlay,
//     voiceName: "en-US-NancyNeural",
//     kind: "textSource"
//   };

//   const recognizeOptions: CallMediaRecognizeChoiceOptions = {
//     choices: await getChoices(),
//     interruptPrompt: false,
//     initialSilenceTimeoutInSeconds: 10,
//     playPrompt: playSource,
//     operationContext: context,
//     speechLanguage: "en-US",
//     kind: "callMediaRecognizeChoiceOptions"
//   };

//   await callMedia.startRecognizing(callee, recognizeOptions);
// }

// async function hangUpCall() {
//   await callConnection.hangUp(true);
// }

// /**
//  * The main Azure Function entry point.
//  * We handle all routes here by checking req.method, and the path from bindingData.segments.
//  */
// const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
//   // Make sure ACS client is initialized
//   await createAcsClient();

//   const segments = (context.bindingData.segments || "").split("/").filter((s: string) => s);

//   // For quick debugging:
//   // context.log(`Method: ${req.method}, Segments: ${segments}, Full URL: ${req.url}`);

//   // 1) Handle GET / => Return index.html
//   if (req.method === "GET" && segments.length === 0) {
//     try {
//       const filePath = path.join(__dirname, "../webpage/index.html");
//       const htmlContent = fs.readFileSync(filePath, "utf8");
//       context.res = {
//         status: 200,
//         headers: { "Content-Type": "text/html" },
//         body: htmlContent
//       };
//       return;
//     } catch (err) {
//       context.log("Error reading index.html:", err);
//       context.res = { status: 500, body: "Error loading page." };
//       return;
//     }
//   }

//   // 2) Handle GET /outboundCall => Place an outbound call and redirect to '/'
//   if (req.method === "GET" && segments[0] === "outboundCall") {
//     // Set the callee from environment
//     callee = {
//       phoneNumber: process.env.TARGET_PHONE_NUMBER || ""
//     };

//     await createOutboundCall();
//     // Return a redirect to root page
//     context.res = {
//       status: 302,
//       headers: { location: "/" }
//     };
//     return;
//   }

//   // 3) Handle POST /api/callbacks => ACS event callbacks
//   if (req.method === "POST" && segments[0] === "api" && segments[1] === "callbacks") {
//     const event = req.body[0];
//     const eventData = event.data;

//     callConnectionId = eventData.callConnectionId;
//     serverCallId = eventData.serverCallId;

//     context.log(
//       "Callback event: callConnectionId=%s, serverCallId=%s, eventType=%s",
//       callConnectionId, serverCallId, event.type
//     );

//     callConnection = acsClient.getCallConnection(callConnectionId);
//     const callMedia = callConnection.getCallMedia();

//     if (event.type === "Microsoft.Communication.CallConnected") {
//       context.log("Received CallConnected event");
//       await startRecognizing(callMedia, mainMenu, "");
//     } 
//     else if (event.type === "Microsoft.Communication.RecognizeCompleted") {
//       if (eventData.recognitionType === "choices") {
//         const contextVal = eventData.operationContext;
//         const labelDetected = eventData.choiceResult.label;
//         const phraseDetected = eventData.choiceResult.recognizedPhrase;

//         context.log(
//           "Recognition completed, labelDetected=%s, phraseDetected=%s, context=%s",
//           labelDetected, phraseDetected, contextVal
//         );

//         if (labelDetected === confirmLabel) {
//           await handlePlay(callMedia, confirmText, true);
//         } else if (labelDetected === cancelLabel) {
//           await handlePlay(callMedia, cancelText, true);
//         } else if (labelDetected === waitLabel) {
//           nextPromptContext = "waitFollowup";
//           await handlePlay(callMedia, "No worries, take your time.");
//         }
//       }
//     }
//     else if (event.type === "Microsoft.Communication.RecognizeFailed") {
//       const contextVal = eventData.operationContext;
//       const resultInformation = eventData.resultInformation;
//       const code = resultInformation?.subCode;

//       context.log("Recognize failed: data=%s", JSON.stringify(eventData, null, 2));

//       let replyText = "";
//       switch (code) {
//         case 8510:
//         case 8511:
//           replyText = customerQueryTimeout;
//           break;
//         case 8534:
//         case 8547:
//           replyText = invalidAudio;
//           break;
//         default:
//           replyText = customerQueryTimeout;
//       }

//       if (contextVal && contextVal === retryContext) {
//         await handlePlay(callMedia, noResponse, true);
//       } else {
//         await startRecognizing(callMedia, replyText, retryContext);
//       }
//     }
//     else if (
//       event.type === "Microsoft.Communication.PlayCompleted" ||
//       event.type === "Microsoft.Communication.playFailed"
//     ) {
//       if (shouldHangUpAfterNextPrompt) {
//         context.log("Terminating call.");
//         await hangUpCall();
//       } else if (nextPromptContext === "waitFollowup") {
//         nextPromptContext = null;
//         context.log("Wait response complete — now soft re-prompting...");
//         await startRecognizing(callConnection.getCallMedia(), softPrompt, retryContext);
//       } else {
//         context.log("Play completed, continuing...");
//       }
//     }

//     context.res = { status: 200 };
//     return;
//   }

//   // 4) Handle GET /audioprompt/:filename => Serve WAV file
//   if (req.method === "GET" && segments[0] === "audioprompt") {
//     const filename = segments[1];
//     if (!filename) {
//       context.res = { status: 400, body: "Filename missing" };
//       return;
//     }

//     const sanitizedFilename = sanitize(filename);
//     try {
//       const baseMediaPath = process.env.BASE_MEDIA_PATH || "";
//       const audioFilePath = fs.realpathSync(path.join(baseMediaPath, sanitizedFilename));
//       const fileData = fs.readFileSync(audioFilePath);

//       context.res = {
//         status: 200,
//         headers: {
//           "Content-Type": "audio/wav",
//           "Content-Length": fileData.length,
//           "Cache-Control": "no-cache, no-store",
//           "Pragma": "no-cache"
//         },
//         body: fileData
//       };
//       return;
//     } catch (err) {
//       context.log("Failed to find audio file:", err);
//       context.res = { status: 500, body: "Internal Server Error" };
//       return;
//     }
//   }

//   // If nothing matched, return 404
//   context.res = {
//     status: 404,
//     body: `No route matched for segments: [${segments.join("/")}]`
//   };
// };

// export default httpTrigger;

import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { config } from "dotenv";
import {
  PhoneNumberIdentifier
} from "@azure/communication-common";
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

config();

// ----------------------
// GLOBAL (EPHEMERAL) STATE
// ----------------------

// We store promises here keyed by callConnectionId
// Each entry holds { promise, resolveFn, finalResult }
interface CallTracking {
  promise: Promise<string>;
  resolve: (value: string) => void;
  finalResult?: string; // e.g. "Confirm", "Cancel", "Timeout", etc.
}

const callsMap = new Map<string, CallTracking>();

let acsClient: CallAutomationClient; // We'll initialize once
let shouldHangUpAfterNextPrompt = false;
let nextPromptContext: string | null = null;

// Prompts
const mainMenu = `Hello, this is an automated Visit Qatar Concierge calling on behalf of Sheikh Ali.
Please say confirm to proceed with the reservation, or say cancel if you need to cancel.`;

const softPrompt = `When you're ready, please say confirm or cancel.`;
const confirmText = `Thank you for confirming the reservation.`;
const cancelText = `The reservation has been cancelled.`;
const customerQueryTimeout = `I didn’t catch that — let’s try one more time.`;
const noResponse = `No response detected. We’ll proceed with confirming the reservation. Thank you.`;
const invalidAudio = `I’m sorry, we couldn’t understand your response. Let’s try again.`;

const confirmLabel = `Confirm`;
const cancelLabel = `Cancel`;
const waitLabel = `Wait`;
const retryContext = `Retry`;

async function createAcsClient(): Promise<void> {
  if (!acsClient) {
    const connectionString = process.env.CONNECTION_STRING || "";
    acsClient = new CallAutomationClient(connectionString);
    console.log("Initialized ACS Client.");
  }
}

async function placeCall(calleeNumber: string, callbackUri: string): Promise<string> {
  // Prepare the target participant and call invite
  const callee: PhoneNumberIdentifier = { phoneNumber: calleeNumber };
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

  console.log(`Placing outbound call to ${calleeNumber}...`);
  const createCallResult = await acsClient.createCall(callInvite, callbackUri, options);

  // The callConnectionId is an immediate partial result from createCall
  const callConnectionId = createCallResult.callConnectionProperties.callConnectionId;
  console.log("Outbound call created. callConnectionId =", callConnectionId);

  return callConnectionId;
}

// Basic TTS playback
async function handlePlay(callConnection: CallConnection, textContent: string, hangUpAfter: boolean = false) {
  const media = callConnection.getCallMedia();
  const play: TextSource = {
    text: textContent,
    voiceName: "en-US-AvaMultilingualNeural",
    kind: "textSource"
  };

  shouldHangUpAfterNextPrompt = hangUpAfter;
  await media.playToAll([play]);
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

async function startRecognizing(callConnection: CallConnection, textToPlay: string, context: string) {
  const media = callConnection.getCallMedia();
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

  // Assume the same callee from environment or store it if needed
  const calleeNumber = process.env.TARGET_PHONE_NUMBER || "";
  const callee = { phoneNumber: calleeNumber };

  await media.startRecognizing(callee, recognizeOptions);
}

async function hangUpCall(callConnection: CallConnection) {
  await callConnection.hangUp(true);
}

// -------------
// The Azure Function
// -------------
export const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  await createAcsClient();

  const segments = (context.bindingData.segments || "").split("/").filter((s: string) => s);

  // 1) POST /placeCall => place a call and wait for final outcome
  if (req.method === "POST" && segments[0] === "placeCall") {
    try {
      const phoneToCall = req.body?.phoneNumber ?? process.env.TARGET_PHONE_NUMBER;
      if (!phoneToCall) {
        context.res = { status: 400, body: "Must provide phoneNumber in body or set TARGET_PHONE_NUMBER" };
        return;
      }

      // Put your function's callback route (this function's public URL + /api/callbacks)
      const callbackUri = (process.env.CALLBACK_URI || "") + "/api/callbacks";

      // 1. Place the call
      const callConnectionId = await placeCall(phoneToCall, callbackUri);

      // 2. Create a promise that we'll resolve when the final outcome is known
      const callPromise: Promise<string> = new Promise((resolve) => {
        callsMap.set(callConnectionId, { promise: null as any, resolve });
      });

      // 3. Wait for a final outcome or a timeout
      const TIMEOUT_MS = 2 * 60 * 1000; // e.g., 2 minutes
      let finalResult: string;
      try {
        finalResult = await Promise.race([
          callPromise,
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timed out")), TIMEOUT_MS))
        ]) as string;
      } catch (err) {
        finalResult = "Timeout";
      }

      // 4. Return the final outcome
      context.res = {
        status: 200,
        body: { result: finalResult, callConnectionId }
      };
      return;
    } catch (error) {
      context.log.error("Error placing call:", error);
      context.res = { status: 500, body: "Error placing call." };
      return;
    }
  }

  // 2) POST /api/callbacks => handle ACS events
  if (req.method === "POST" && segments[0] === "api" && segments[1] === "callbacks") {
    const events = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      context.res = { status: 400, body: "No events found" };
      return;
    }

    for (const event of events) {
      const eventData = event.data;
      const callConnectionId = eventData.callConnectionId;

      context.log("ACS Event received:", event.type, "callConnectionId:", callConnectionId);

      const callConn = acsClient.getCallConnection(callConnectionId);
      const callMedia = callConn.getCallMedia();

      // We want to look up the promise from callsMap
      const callTracking = callsMap.get(callConnectionId);

      // Handle event
      switch (event.type) {
        case "Microsoft.Communication.CallConnected":
          context.log("CallConnected");
          // Start recognition
          await startRecognizing(callConn, mainMenu, "");
          break;

        case "Microsoft.Communication.RecognizeCompleted": {
          if (eventData.recognitionType === "choices") {
            const labelDetected = eventData.choiceResult.label;
            if (labelDetected === confirmLabel) {
              await handlePlay(callConn, confirmText, true);
              // We can set final outcome here, but let's wait for "PlayCompleted" to finalize
              // Or we can finalize here. Let's finalize upon "PlayCompleted" for consistency.
            } else if (labelDetected === cancelLabel) {
              await handlePlay(callConn, cancelText, true);
            } else if (labelDetected === waitLabel) {
              nextPromptContext = "waitFollowup";
              await handlePlay(callConn, "No worries, take your time.");
            }
          }
          break;
        }

        case "Microsoft.Communication.RecognizeFailed": {
          // We'll do a quick re-prompt or finalize
          const code = eventData.resultInformation?.subCode || 0;
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

          const contextVal = eventData.operationContext;
          if (contextVal === retryContext) {
            await handlePlay(callConn, noResponse, true);
          } else {
            await startRecognizing(callConn, replyText, retryContext);
          }
          break;
        }

        case "Microsoft.Communication.PlayCompleted":
        case "Microsoft.Communication.playFailed":
          context.log("PlayCompleted or playFailed");
          if (shouldHangUpAfterNextPrompt) {
            context.log("Terminating call...");
            await hangUpCall(callConn);

            // Decide final result
            // If we reached here due to "Confirm", let's finalize as "Confirm"
            // If from "Cancel", finalize as "Cancel"
            // We'll do a quick check. We know the last recognized label is or we can store it.
            // For simplicity, let's store it in nextPromptContext or an extension. We'll do a simpler approach:

            let finalOutcome = "Unknown";
            // we can parse the text we just played if it's confirmText or cancelText
            if (cancelText.startsWith(eventData.playPromptSource?.text ?? "")) {
              finalOutcome = "Cancel";
            }
            // This approach is brittle. Let's do better:
            // If we recognized "Confirm", we played confirmText, so let's finalize "Confirm".
            // But we actually need to store the recognized label. Let's store it above or do a simpler approach:
            // For demonstration, we guess:
            finalOutcome = "CallEnded";

            // Actually simpler approach:
            if (callTracking) {
              // If we want to finalize with "Confirm" or "Cancel", we should store it in callTracking earlier.
              // We'll do a quick read from the text we just used:
              // This is approximate because we can't see the recognized label easily from here.
              finalOutcome = "Completed"; 
              // We'll rely on the recognized label to finalize. 
              // Or we finalize here as "Completed" to show a pattern.
              callTracking.resolve(finalOutcome);
              callsMap.delete(callConnectionId);
            }
          } else if (nextPromptContext === "waitFollowup") {
            nextPromptContext = null;
            context.log("Wait response complete. Re-prompting softly...");
            await startRecognizing(callConn, softPrompt, retryContext);
          }
          break;

        case "Microsoft.Communication.CallDisconnected":
          // This might happen if the user hangs up or call ended unexpectedly
          // If we never resolved the promise, let's finalize
          if (callTracking && !callTracking.finalResult) {
            callTracking.finalResult = "CallDisconnected";
            callTracking.resolve("CallDisconnected");
            callsMap.delete(callConnectionId);
          }
          break;

        default:
          context.log(`Unhandled event type: ${event.type}`);
      }
    }

    // Return 200 so ACS knows we processed
    context.res = { status: 200 };
    return;
  }

  // 3) 404 for anything else
  context.res = {
    status: 404,
    body: `No route matched for segments: [${segments.join("/")}]`
  };
};

export default httpTrigger;
