"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sanitize_filename_1 = __importDefault(require("sanitize-filename"));
const communication_call_automation_1 = require("@azure/communication-call-automation");
// Load .env locally, but in Azure you use the Function's Application Settings
(0, dotenv_1.config)();
// Global variables (caveat: Azure Functions can be ephemeral so do not rely on these in production)
let callConnectionId;
let callConnection;
let serverCallId;
let callee;
let acsClient;
let shouldHangUpAfterNextPrompt = false;
let nextPromptContext = null;
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
function createAcsClient() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!acsClient) {
            const connectionString = process.env.CONNECTION_STRING || "";
            acsClient = new communication_call_automation_1.CallAutomationClient(connectionString);
            console.log("Initialized ACS Client.");
        }
    });
}
function createOutboundCall() {
    return __awaiter(this, void 0, void 0, function* () {
        const callInvite = {
            targetParticipant: callee,
            sourceCallIdNumber: {
                phoneNumber: process.env.ACS_RESOURCE_PHONE_NUMBER || "",
            },
        };
        const options = {
            callIntelligenceOptions: {
                cognitiveServicesEndpoint: process.env.COGNITIVE_SERVICES_ENDPOINT
            }
        };
        console.log("Placing outbound call...");
        yield acsClient.createCall(callInvite, 
        // This callback route must match how ACS is configured to POST events back here
        (process.env.CALLBACK_URI || "") + "/api/callbacks", options);
    });
}
function handlePlay(callConnectionMedia_1, textContent_1) {
    return __awaiter(this, arguments, void 0, function* (callConnectionMedia, textContent, hangUpAfter = false) {
        const play = {
            text: textContent,
            voiceName: "en-US-AvaMultilingualNeural",
            kind: "textSource"
        };
        shouldHangUpAfterNextPrompt = hangUpAfter;
        yield callConnectionMedia.playToAll([play]);
    });
}
function getChoices() {
    return __awaiter(this, void 0, void 0, function* () {
        return [
            {
                label: confirmLabel,
                phrases: ["Confirm", "First", "One"],
                tone: communication_call_automation_1.DtmfTone.One
            },
            {
                label: cancelLabel,
                phrases: ["Cancel", "Second", "Two"],
                tone: communication_call_automation_1.DtmfTone.Two
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
                tone: communication_call_automation_1.DtmfTone.Three
            }
        ];
    });
}
function startRecognizing(callMedia, textToPlay, context) {
    return __awaiter(this, void 0, void 0, function* () {
        const playSource = {
            text: textToPlay,
            voiceName: "en-US-NancyNeural",
            kind: "textSource"
        };
        const recognizeOptions = {
            choices: yield getChoices(),
            interruptPrompt: false,
            initialSilenceTimeoutInSeconds: 10,
            playPrompt: playSource,
            operationContext: context,
            speechLanguage: "en-US",
            kind: "callMediaRecognizeChoiceOptions"
        };
        yield callMedia.startRecognizing(callee, recognizeOptions);
    });
}
function hangUpCall() {
    return __awaiter(this, void 0, void 0, function* () {
        yield callConnection.hangUp(true);
    });
}
/**
 * The main Azure Function entry point.
 * We handle all routes here by checking req.method, and the path from bindingData.segments.
 */
const httpTrigger = function (context, req) {
    return __awaiter(this, void 0, void 0, function* () {
        // Make sure ACS client is initialized
        yield createAcsClient();
        const segments = (context.bindingData.segments || "").split("/").filter((s) => s);
        // For quick debugging:
        // context.log(`Method: ${req.method}, Segments: ${segments}, Full URL: ${req.url}`);
        // 1) Handle GET / => Return index.html
        if (req.method === "GET" && segments.length === 0) {
            try {
                const filePath = path_1.default.join(__dirname, "../webpage/index.html");
                const htmlContent = fs_1.default.readFileSync(filePath, "utf8");
                context.res = {
                    status: 200,
                    headers: { "Content-Type": "text/html" },
                    body: htmlContent
                };
                return;
            }
            catch (err) {
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
            yield createOutboundCall();
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
            context.log("Callback event: callConnectionId=%s, serverCallId=%s, eventType=%s", callConnectionId, serverCallId, event.type);
            callConnection = acsClient.getCallConnection(callConnectionId);
            const callMedia = callConnection.getCallMedia();
            if (event.type === "Microsoft.Communication.CallConnected") {
                context.log("Received CallConnected event");
                yield startRecognizing(callMedia, mainMenu, "");
            }
            else if (event.type === "Microsoft.Communication.RecognizeCompleted") {
                if (eventData.recognitionType === "choices") {
                    const contextVal = eventData.operationContext;
                    const labelDetected = eventData.choiceResult.label;
                    const phraseDetected = eventData.choiceResult.recognizedPhrase;
                    context.log("Recognition completed, labelDetected=%s, phraseDetected=%s, context=%s", labelDetected, phraseDetected, contextVal);
                    if (labelDetected === confirmLabel) {
                        yield handlePlay(callMedia, confirmText, true);
                    }
                    else if (labelDetected === cancelLabel) {
                        yield handlePlay(callMedia, cancelText, true);
                    }
                    else if (labelDetected === waitLabel) {
                        nextPromptContext = "waitFollowup";
                        yield handlePlay(callMedia, "No worries, take your time.");
                    }
                }
            }
            else if (event.type === "Microsoft.Communication.RecognizeFailed") {
                const contextVal = eventData.operationContext;
                const resultInformation = eventData.resultInformation;
                const code = resultInformation === null || resultInformation === void 0 ? void 0 : resultInformation.subCode;
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
                    yield handlePlay(callMedia, noResponse, true);
                }
                else {
                    yield startRecognizing(callMedia, replyText, retryContext);
                }
            }
            else if (event.type === "Microsoft.Communication.PlayCompleted" ||
                event.type === "Microsoft.Communication.playFailed") {
                if (shouldHangUpAfterNextPrompt) {
                    context.log("Terminating call.");
                    yield hangUpCall();
                }
                else if (nextPromptContext === "waitFollowup") {
                    nextPromptContext = null;
                    context.log("Wait response complete — now soft re-prompting...");
                    yield startRecognizing(callConnection.getCallMedia(), softPrompt, retryContext);
                }
                else {
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
            const sanitizedFilename = (0, sanitize_filename_1.default)(filename);
            try {
                const baseMediaPath = process.env.BASE_MEDIA_PATH || "";
                const audioFilePath = fs_1.default.realpathSync(path_1.default.join(baseMediaPath, sanitizedFilename));
                const fileData = fs_1.default.readFileSync(audioFilePath);
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
            }
            catch (err) {
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
    });
};
exports.default = httpTrigger;
