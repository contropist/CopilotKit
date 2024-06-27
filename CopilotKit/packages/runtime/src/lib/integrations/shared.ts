import { YogaInitialContext } from "graphql-yoga";
import { buildSchemaSync } from "type-graphql";
import { CopilotResolver } from "../../graphql/resolvers/copilot.resolver";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";
import { CopilotRuntime } from "../copilot-runtime";
import { CopilotServiceAdapter } from "../../service-adapters";
import { CopilotCloudOptions } from "../cloud";
import { LogLevel, createLogger } from "../../lib/logger";
import { createYoga } from "graphql-yoga";

const logger = createLogger();

type AnyPrimitive = string | boolean | number | null;
export type CopilotRequestContextProperties = Record<
  string,
  AnyPrimitive | Record<string, AnyPrimitive>
>;

export type GraphQLContext = YogaInitialContext & {
  _copilotkit: CreateCopilotRuntimeServerOptions;
  properties: CopilotRequestContextProperties;
  logger: typeof logger;
};

export interface CreateCopilotRuntimeServerOptions {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  endpoint: string;
  baseUrl?: string;
  cloud?: CopilotCloudOptions;
  properties?: CopilotRequestContextProperties;
  logLevel?: LogLevel;
}

export async function createContext(
  initialContext: YogaInitialContext,
  copilotKitContext: CreateCopilotRuntimeServerOptions,
  contextLogger: typeof logger,
  properties: CopilotRequestContextProperties = {},
): Promise<Partial<GraphQLContext>> {
  logger.debug({ copilotKitContext }, "Creating GraphQL context");
  const ctx: GraphQLContext = {
    ...initialContext,
    _copilotkit: {
      ...copilotKitContext,
    },
    properties: { ...properties },
    logger: contextLogger,
  };
  return ctx;
}

export function buildSchema(
  options: {
    emitSchemaFile?: string;
  } = {},
) {
  logger.debug("Building GraphQL schema...");
  const schema = buildSchemaSync({
    resolvers: [CopilotResolver],
    emitSchemaFile: options.emitSchemaFile,
  });
  logger.debug("GraphQL schema built successfully");
  return schema;
}

export type CommonConfig = {
  logging: typeof logger;
  schema: ReturnType<typeof buildSchema>;
  plugins: Parameters<typeof createYoga>[0]["plugins"];
  context: (ctx: YogaInitialContext) => Promise<Partial<GraphQLContext>>;
};

export function getCommonConfig(options: CreateCopilotRuntimeServerOptions): CommonConfig {
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || (options.logLevel as LogLevel) || "error";
  const logger = createLogger({ level: logLevel, component: "getCommonConfig" });
  logger.debug("Getting common config");

  const contextLogger = createLogger({ level: logLevel });

  return {
    logging: createLogger({ component: "Yoga GraphQL", level: logLevel }),
    schema: buildSchema(),
    plugins: [useDeferStream()],
    context: (ctx: YogaInitialContext): Promise<Partial<GraphQLContext>> =>
      createContext(ctx, options, contextLogger, options.properties),
  };
}
