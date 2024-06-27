import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";

export function copilotRuntimeNextJSAppRouterEndpoint(options: CreateCopilotRuntimeServerOptions) {
  const commonConfig = getCommonConfig(options);
  const logger = commonConfig.logging;
  logger.debug("Creating NextJS App Router endpoint");

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: options.endpoint,
    fetchAPI: { Response: globalThis.Response },
  });

  return {
    handleRequest: yoga,
    GET: yoga as any,
    POST: yoga as any,
    OPTIONS: yoga as any,
  };
}
