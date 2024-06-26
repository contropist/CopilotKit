/**
 * CopilotKit Adapter for Google Gemini
 *
 * Use this adapter for a Google Gemini backend.
 *
 * <RequestExample>
 * ```typescript
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new GoogleGenerativeAIAdapter()
 * );
 * ```
 * </RequestExample>
 *
 * To set up a different model, pass the model prop:
 *
 * ```typescript
 * const copilotKit = new CopilotRuntime();
 * const genAI = new GoogleGenerativeAI(
 *  process.env["GOOGLE_API_KEY"]!
 * );
 * const model = genAI.getGenerativeModel(
 *  { model: "gemini-pro" }
 * );
 * return copilotKit.response(
 *   req,
 *   new GoogleGenerativeAIAdapter()
 * );
 * ```
 */
import { CopilotKitServiceAdapter } from "../types";
import { CopilotKitResponse } from "../types/service-adapter";
import { Content, GenerativeModel, GoogleGenerativeAI, Tool } from "@google/generative-ai";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils";
import { ChatCompletionChunk, Message } from "@copilotkit/shared";

interface GoogleGenerativeAIAdapterOptions {
  /**
   * A custom `GenerativeModel` to use for the request.
   */
  model?: GenerativeModel;
}

export class GoogleGenerativeAIAdapter implements CopilotKitServiceAdapter {
  private model: GenerativeModel;

  constructor(options?: GoogleGenerativeAIAdapterOptions) {
    if (options?.model) {
      this.model = options.model;
    } else {
      const genAI = new GoogleGenerativeAI(process.env["GOOGLE_API_KEY"]!);
      this.model = genAI.getGenerativeModel({ model: "gemini-pro" });
    }
  }

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    const messages = forwardedProps.messages;

    const history = this.transformMessages(messages.slice(0, -1));
    const currentMessage = messages[messages.length - 1];
    const systemMessage = messages.shift()?.content.trim() || "";

    const isFirstGenGeminiPro =
      this.model.model === "gemini-pro" || this.model.model === "models/gemini-pro";

    const chat = this.model.startChat({
      history: [
        ...history,
        // gemini-pro does not support system instructions, so we need to add them to the history
        ...(isFirstGenGeminiPro ? [{ role: "user", parts: [{ text: systemMessage }] }] : []),
      ],
      // only gemini-1.5-pro-latest and later supports setting system instructions
      ...(isFirstGenGeminiPro
        ? {}
        : { systemInstruction: { role: "user", parts: [{ text: systemMessage }] } }),
      tools: this.transformTools(forwardedProps.tools || []),
    });

    const result = await chat.sendMessageStream(this.transformMessage(currentMessage).parts);

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          const ccChunk: ChatCompletionChunk = {
            choices: [
              {
                delta: {
                  role: "assistant",
                  content: chunkText,
                },
              },
            ],
          };

          writeChatCompletionChunk(controller, ccChunk);
        }
        let calls = (await result.response).functionCalls();
        if (calls && calls.length > 0) {
          const ccChunk: ChatCompletionChunk = {
            choices: [
              {
                delta: {
                  role: "assistant",
                  content: "",
                  tool_calls: calls.map((call, ix) => ({
                    index: ix,
                    id: ix + "",
                    function: {
                      name: call.name,
                      arguments: JSON.stringify(replaceNewlinesInObject(call.args)),
                    },
                  })),
                },
              },
            ],
          };

          writeChatCompletionChunk(controller, ccChunk);
        }
        writeChatCompletionEnd(controller);
        controller.close();
      },
    });

    return {
      stream,
    };
  }

  transformMessages(messages: Message[]): Content[] {
    return messages
      .filter(
        (m) =>
          m.role === "user" ||
          m.role === "assistant" ||
          m.role === "function" ||
          m.role === "system",
      )
      .map(this.transformMessage);
  }

  transformMessage(message: Message): Content {
    if (message.role === "user") {
      return {
        role: "user",
        parts: [{ text: message.content }],
      };
    } else if (message.role === "assistant") {
      if (message.function_call) {
        return {
          role: "model",
          parts: [
            {
              functionCall: {
                name: message.function_call.name!,
                args: JSON.parse(message.function_call!.arguments!),
              },
            },
          ],
        };
      } else {
        return {
          role: "model",
          parts: [{ text: message.content.replace("\\\\n", "\n") }],
        };
      }
    } else if (message.role === "function") {
      return {
        role: "function",
        parts: [
          {
            functionResponse: {
              name: message.name!,
              response: {
                name: message.name!,
                content: tryParseJson(message.content),
              },
            },
          },
        ],
      };
    } else if (message.role === "system") {
      return {
        role: "user",
        parts: [
          {
            text:
              "THE FOLLOWING MESSAGE IS NOT A USER MESSAGE. IT IS A SYSTEM MESSAGE: " +
              message.content,
          },
        ],
      };
    }

    throw new Error("Invalid message role");
  }

  transformTools(tools: any[]) {
    return tools.map(this.transformTool);
  }

  transformTool(tool: any): Tool {
    const name = tool.function.name;
    const description = tool.function.description;
    const parameters = tool.function.parameters;

    const transformProperties = (props: any) => {
      for (const key in props) {
        if (props[key].type) {
          props[key].type = props[key].type.toUpperCase();
        }
        if (props[key].properties) {
          transformProperties(props[key].properties);
        }
      }
    };

    transformProperties(parameters);

    return {
      functionDeclarations: [
        {
          name,
          description,
          parameters,
        },
      ],
    };
  }
}

function tryParseJson(str?: string) {
  if (!str) {
    return "";
  }
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}

function replaceNewlinesInObject(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/\\\\n/g, "\n");
  } else if (Array.isArray(obj)) {
    return obj.map(replaceNewlinesInObject);
  } else if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        newObj[key] = replaceNewlinesInObject(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}
