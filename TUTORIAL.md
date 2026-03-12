---
title: "Build a Youtube agent with LangChain (TypeScript) and Arcade"
slug: "ts-langchain-Youtube"
framework: "langchain-ts"
language: "typescript"
toolkits: ["Youtube"]
tools: []
difficulty: "beginner"
generated_at: "2026-03-12T01:34:33Z"
source_template: "ts_langchain"
agent_repo: ""
tags:
  - "langchain"
  - "typescript"
  - "youtube"
---

# Build a Youtube agent with LangChain (TypeScript) and Arcade

In this tutorial you'll build an AI agent using [LangChain](https://js.langchain.com/) with [LangGraph](https://langchain-ai.github.io/langgraphjs/) in TypeScript and [Arcade](https://arcade.dev) that can interact with Youtube tools — with built-in authorization and human-in-the-loop support.

## Prerequisites

- The [Bun](https://bun.com) runtime
- An [Arcade](https://arcade.dev) account and API key
- An OpenAI API key

## Project Setup

First, create a directory for this project, and install all the required dependencies:

````bash
mkdir youtube-agent && cd youtube-agent
bun install @arcadeai/arcadejs @langchain/langgraph @langchain/core langchain chalk
````

## Start the agent script

Create a `main.ts` script, and import all the packages and libraries. Imports from 
the `"./tools"` package may give errors in your IDE now, but don't worry about those
for now, you will write that helper package later.

````typescript
"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";
````

## Configuration

In `main.ts`, configure your agent's toolkits, system prompt, and model. Notice
how the system prompt tells the agent how to navigate different scenarios and
how to combine tool usage in specific ways. This prompt engineering is important
to build effective agents. In fact, the more agentic your application, the more
relevant the system prompt to truly make the agent useful and effective at
using the tools at its disposal.

````typescript
// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['Youtube'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = "# YouTube Agent Prompt (for a ReAct-style agent)\n\n## Introduction\nYou are a YouTube research agent. Your purpose is to find, inspect, and summarize YouTube video results for user queries by using two tools:\n- Youtube_SearchForVideos (search for videos by keywords, with pagination)\n- Youtube_GetYoutubeVideoDetails (retrieve detailed metadata for a specific video by ID)\n\nYou must follow the ReAct (Reasoning + Acting) style: alternate explicit thoughts, actions (tool calls), and observations; then synthesize answers for the user. Never hallucinate \u2014 always use tool observations for facts, and ask clarification questions when the user\u2019s request is ambiguous.\n\n---\n\n## Instructions\n- Follow ReAct format in your internal reasoning and when demonstrating actions:\n  - Thought: (your reasoning about what to do)\n  - Action: (tool call with parameters)\n  - Observation: (tool response)\n  - Repeat until you have enough information, then produce the final answer.\n- Do not output fabricated details. If a fact is not available from the tools, say so and offer to fetch it.\n- Ask clarifying questions if the user\u2019s request lacks necessary details (e.g., preferred language, country, time range, how many results, whether they want a deep-dive or quick summary).\n- Use `language_code` (default \"en\") and `country_code` (optional) to localize searches if the user requests it.\n- Use pagination (`next_page_token`) when the user wants more results than the first page or a specific number of results.\n- When retrieving many video details, batch the calls responsibly (e.g., request details for a reasonable number of IDs per step) to avoid excessive calls.\n- Provide clear, sourced outputs: always include video title, channel name, video ID, link (https://youtu.be/\u003cvideo_id\u003e), published date, duration, and view count when available. Include short descriptions (1\u20133 sentences) and why the video is relevant to the query.\n- If a tool returns zero results or an error, explain and ask whether to broaden or refine the search.\n- If comparing videos, present a concise comparison (bulleted list or CSV-like rows) highlighting the criteria requested (views, length, upload date, focus).\n- If asked to monitor trends or create alerts, propose a polling frequency and what to watch for, and ask permission before starting repeated queries.\n\n---\n\n## Workflows\nBelow are common workflows with the expected sequence of tool calls and how to reason about them.\n\n1) Quick search + single-video summary\n- Use case: User asks \"Find a good tutorial on X\" or \"Summarize this video [ID]\".\n- Sequence:\n  1. Thought: Decide whether to search or fetch details (based on user input).\n  2. Action: Youtube_SearchForVideos { \"keywords\": \"\u003cuser keywords\u003e\", \"language_code\": \"en\", \"country_code\": \"\u003cif given\u003e\" }\n  3. Observation: (search results)\n  4. Thought: Pick best candidate(s) (based on relevance, views, recency).\n  5. Action: Youtube_GetYoutubeVideoDetails { \"video_id\": \"\u003cchosen id\u003e\", \"language_code\": \"en\", \"country_code\": \"\u003cif given\u003e\" }\n  6. Observation: (video details)\n  7. Final answer: Provide a concise summary, metadata, link, and why it\u2019s recommended.\n- Example ReAct fragment:\n  ```\n  Thought: The user asked for a beginner Python tutorial. Search YouTube in English.\n  Action: Youtube_SearchForVideos { \"keywords\": \"beginner python tutorial\", \"language_code\": \"en\" }\n  Observation: [search results returned]\n  Thought: Select the top result (id = abc123). Retrieve details.\n  Action: Youtube_GetYoutubeVideoDetails { \"video_id\": \"abc123\", \"language_code\": \"en\" }\n  Observation: [video details returned]\n  Final Answer: ...\n  ```\n\n2) Deep-dive on a single video (given ID or chosen from search)\n- Use case: User gave a video ID or asked for an in-depth breakdown.\n- Sequence:\n  1. Thought: User provided a video ID or selected one from search.\n  2. Action: Youtube_GetYoutubeVideoDetails { \"video_id\": \"\u003cid\u003e\", \"language_code\": \"en\" }\n  3. Observation: (detailed metadata and description)\n  4. Thought: Extract sections: transcript (if not available via tools, say so), main points from description/title, and metrics.\n  5. Final answer: Detailed summary, timestamps (if available in description), and suggested related videos (use a follow-up search: Youtube_SearchForVideos with key phrases from title/description).\n- Note: If the user asks for a transcript but the tool does not provide it, explain limitation and offer to search for captions or ask permission to fetch via another service.\n\n3) Comparative analysis across multiple videos\n- Use case: \"Compare top 5 videos about X\" or \"Which is the best video on Y?\"\n- Sequence:\n  1. Thought: Determine how many results \u0026 whether to paginate.\n  2. Action: Youtube_SearchForVideos { \"keywords\": \"\u003cquery\u003e\", \"language_code\": \"en\", \"next_page_token\": null }\n  3. Observation: (first-page search results)\n  4. Thought: If fewer results than requested, and user asked for N results, use next_page_token:\n     Action: Youtube_SearchForVideos { \"keywords\": \"\u003cquery\u003e\", \"next_page_token\": \"\u003ctoken\u003e\" }\n  5. Observation: (additional results)\n  6. Thought: Collect up to N video IDs.\n  7. Action(s): For each chosen video_id, call Youtube_GetYoutubeVideoDetails { \"video_id\": \"\u003cid\u003e\", ... } \u2014 batch responsibly.\n  8. Observation(s): (details for each video)\n  9. Final answer: Present a comparison table or bullets with title, channel, views, duration, published date, short description, and recommendation.\n- Example output format:\n  - Video title (link): Channel \u2014 views \u2014 duration \u2014 published date\n    - Short 1\u20132 sentence summary and recommendation.\n\n4) Localized / Region-specific search\n- Use case: User wants region-specific or language-specific videos (e.g., \"best guitar lessons in Spanish in Mexico\")\n- Sequence:\n  1. Thought: Include language_code and country_code.\n  2. Action: Youtube_SearchForVideos { \"keywords\": \"\u003cquery\u003e\", \"language_code\": \"\u003clang\u003e\", \"country_code\": \"\u003ccountry\u003e\" }\n  3. Observation: (results)\n  4. Action: Youtube_GetYoutubeVideoDetails for chosen IDs (include the same language/country if available).\n  5. Final answer: Present localized results and note how localization influenced results.\n\n5) Exploration / discovery (broad search and follow-ups)\n- Use case: \"Show me a variety of perspectives on X\" or \"Find recent videos about X from the last month\"\n- Sequence:\n  1. Thought: Clarify date filters (tools may not support direct date filters; if not, fetch details and filter by published date).\n  2. Action: Youtube_SearchForVideos { \"keywords\": \"\u003cquery\u003e\" }\n  3. Observation: (results)\n  4. Action: Youtube_GetYoutubeVideoDetails for results to access published dates and filter.\n  5. Observation: (details)\n  6. Final answer: Present filtered list and note how filtering was performed.\n\n---\n\n## Tool usage examples and formats\n- Calling the search tool:\n  ```\n  Action: Youtube_SearchForVideos { \n    \"keywords\": \"python machine learning tutorial\", \n    \"language_code\": \"en\",\n    \"country_code\": \"us\",\n    \"next_page_token\": null\n  }\n  ```\n- Calling the details tool:\n  ```\n  Action: Youtube_GetYoutubeVideoDetails { \n    \"video_id\": \"dQw4w9WgXcQ\", \n    \"language_code\": \"en\", \n    \"country_code\": \"us\"\n  }\n  ```\n- ReAct turn example:\n  ```\n  Thought: The user asked for top 3 up-to-date videos on topic X; first search is required.\n  Action: Youtube_SearchForVideos { \"keywords\": \"topic X tutorial 2025\", \"language_code\": \"en\" }\n  Observation: [search results...]\n  Thought: Collected 5 candidate ids; now fetch details for top 3 based on views and recency.\n  Action: Youtube_GetYoutubeVideoDetails { \"video_id\": \"id1\" }\n  Observation: [...]\n  Action: Youtube_GetYoutubeVideoDetails { \"video_id\": \"id2\" }\n  Observation: [...]\n  Action: Youtube_GetYoutubeVideoDetails { \"video_id\": \"id3\" }\n  Observation: [...]\n  Final Answer: [Summarized comparisons and links]\n  ```\n\n---\n\n## Best practices and constraints\n- Default parameters: if user does not specify, use language_code = \"en\" and no country_code.\n- Pagination: use next_page_token to fetch more pages; stop when enough results are gathered or token is null.\n- Rate and batch control: if asked for many videos (\u003e\u003e10), confirm before fetching details for all. Suggest incremental results (top 5 first).\n- Error and empty-result handling: If a tool returns an error or empty results, explain clearly and provide options (refine keywords, broaden search, change language/country).\n- Transparency: Cite each video by title and URL (https://youtu.be/\u003cvideo_id\u003e). If you quote any text from the tool results (description/title), attribute it as coming from the video metadata.\n- Final outputs should be user-friendly and actionable: short summaries, links, and clear recommendations.\n\n---\n\nIf you need to demonstrate a specific example workflow for a user query, follow the ReAct format above and then provide a concise final result with citations (video titles, channels, IDs, and links).";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";
````

Set the following environment variables in a `.env` file:

````bash
ARCADE_API_KEY=your-arcade-api-key
ARCADE_USER_ID=your-arcade-user-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
````

## Implementing the `tools.ts` module

The `tools.ts` module fetches Arcade tool definitions and converts them to LangChain-compatible tools using Arcade's Zod schema conversion:

### Create the file and import the dependencies

Create a `tools.ts` file, and add import the following. These will allow you to build the helper functions needed to convert Arcade tool definitions into a format that LangChain can execute. Here, you also define which tools will require human-in-the-loop confirmation. This is very useful for tools that may have dangerous or undesired side-effects if the LLM hallucinates the values in the parameters. You will implement the helper functions to require human approval in this module.

````typescript
import { Arcade } from "@arcadeai/arcadejs";
import {
  type ToolExecuteFunctionFactoryInput,
  type ZodTool,
  executeZodTool,
  isAuthorizationRequiredError,
  toZod,
} from "@arcadeai/arcadejs/lib/index";
import { type ToolExecuteFunction } from "@arcadeai/arcadejs/lib/zod/types";
import { tool } from "langchain";
import {
  interrupt,
} from "@langchain/langgraph";
import readline from "node:readline/promises";

// This determines which tools require human in the loop approval to run
const TOOLS_WITH_APPROVAL = [];
````

### Create a confirmation helper for human in the loop

The first helper that you will write is the `confirm` function, which asks a yes or no question to the user, and returns `true` if theuser replied with `"yes"` and `false` otherwise.

````typescript
// Prompt user for yes/no confirmation
export async function confirm(question: string, rl?: readline.Interface): Promise<boolean> {
  let shouldClose = false;
  let interface_ = rl;

  if (!interface_) {
      interface_ = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
      });
      shouldClose = true;
  }

  const answer = await interface_.question(`${question} (y/n): `);

  if (shouldClose) {
      interface_.close();
  }

  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
````

Tools that require authorization trigger a LangGraph interrupt, which pauses execution until the user completes authorization in their browser.

### Create the execution helper

This is a wrapper around the `executeZodTool` function. Before you execute the tool, however, there are two logical checks to be made:

1. First, if the tool the agent wants to invoke is included in the `TOOLS_WITH_APPROVAL` variable, human-in-the-loop is enforced by calling `interrupt` and passing the necessary data to call the `confirm` helper. LangChain will surface that `interrupt` to the agentic loop, and you will be required to "resolve" the interrupt later on. For now, you can assume that the reponse of the `interrupt` will have enough information to decide whether to execute the tool or not, depending on the human's reponse.
2. Second, if the tool was approved by the human, but it doesn't have the authorization of the integration to run, then you need to present an URL to the user so they can authorize the OAuth flow for this operation. For this, an execution is attempted, that may fail to run if the user is not authorized. When it fails, you interrupt the flow and send the authorization request for the harness to handle. If the user authorizes the tool, the harness will reply with an `{authorized: true}` object, and the system will retry the tool call without interrupting the flow.

````typescript
export function executeOrInterruptTool({
  zodToolSchema,
  toolDefinition,
  client,
  userId,
}: ToolExecuteFunctionFactoryInput): ToolExecuteFunction<any> {
  const { name: toolName } = zodToolSchema;

  return async (input: unknown) => {
    try {

      // If the tool is on the list that enforces human in the loop, we interrupt the flow and ask the user to authorize the tool

      if (TOOLS_WITH_APPROVAL.includes(toolName)) {
        const hitl_response = interrupt({
          authorization_required: false,
          hitl_required: true,
          tool_name: toolName,
          input: input,
        });

        if (!hitl_response.authorized) {
          // If the user didn't approve the tool call, we throw an error, which will be handled by LangChain
          throw new Error(
            `Human in the loop required for tool call ${toolName}, but user didn't approve.`
          );
        }
      }

      // Try to execute the tool
      const result = await executeZodTool({
        zodToolSchema,
        toolDefinition,
        client,
        userId,
      })(input);
      return result;
    } catch (error) {
      // If the tool requires authorization, we interrupt the flow and ask the user to authorize the tool
      if (error instanceof Error && isAuthorizationRequiredError(error)) {
        const response = await client.tools.authorize({
          tool_name: toolName,
          user_id: userId,
        });

        // We interrupt the flow here, and pass everything the handler needs to get the user's authorization
        const interrupt_response = interrupt({
          authorization_required: true,
          authorization_response: response,
          tool_name: toolName,
          url: response.url ?? "",
        });

        // If the user authorized the tool, we retry the tool call without interrupting the flow
        if (interrupt_response.authorized) {
          const result = await executeZodTool({
            zodToolSchema,
            toolDefinition,
            client,
            userId,
          })(input);
          return result;
        } else {
          // If the user didn't authorize the tool, we throw an error, which will be handled by LangChain
          throw new Error(
            `Authorization required for tool call ${toolName}, but user didn't authorize.`
          );
        }
      }
      throw error;
    }
  };
}
````

### Create the tool retrieval helper

The last helper function of this module is the `getTools` helper. This function will take the configurations you defined in the `main.ts` file, and retrieve all of the configured tool definitions from Arcade. Those definitions will then be converted to LangGraph `Function` tools, and will be returned in a format that LangChain can present to the LLM so it can use the tools and pass the arguments correctly. You will pass the `executeOrInterruptTool` helper you wrote in the previous section so all the bindings to the human-in-the-loop and auth handling are programmed when LancChain invokes a tool.


````typescript
// Initialize the Arcade client
export const arcade = new Arcade();

export type GetToolsProps = {
  arcade: Arcade;
  toolkits?: string[];
  tools?: string[];
  userId: string;
  limit?: number;
}


export async function getTools({
  arcade,
  toolkits = [],
  tools = [],
  userId,
  limit = 100,
}: GetToolsProps) {

  if (toolkits.length === 0 && tools.length === 0) {
      throw new Error("At least one tool or toolkit must be provided");
  }

  // Todo(Mateo): Add pagination support
  const from_toolkits = await Promise.all(toolkits.map(async (tkitName) => {
      const definitions = await arcade.tools.list({
          toolkit: tkitName,
          limit: limit
      });
      return definitions.items;
  }));

  const from_tools = await Promise.all(tools.map(async (toolName) => {
      return await arcade.tools.get(toolName);
  }));

  const all_tools = [...from_toolkits.flat(), ...from_tools];
  const unique_tools = Array.from(
      new Map(all_tools.map(tool => [tool.qualified_name, tool])).values()
  );

  const arcadeTools = toZod({
    tools: unique_tools,
    client: arcade,
    executeFactory: executeOrInterruptTool,
    userId: userId,
  });

  // Convert Arcade tools to LangGraph tools
  const langchainTools = arcadeTools.map(({ name, description, execute, parameters }) =>
    (tool as Function)(execute, {
      name,
      description,
      schema: parameters,
    })
  );

  return langchainTools;
}
````

## Building the Agent

Back on the `main.ts` file, you can now call the helper functions you wrote to build the agent.

### Retrieve the configured tools

Use the `getTools` helper you wrote to retrieve the tools from Arcade in LangChain format:

````typescript
const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});
````

### Write an interrupt handler

When LangChain is interrupted, it will emit an event in the stream that you will need to handle and resolve based on the user's behavior. For a human-in-the-loop interrupt, you will call the `confirm` helper you wrote earlier, and indicate to the harness whether the human approved the specific tool call or not. For an auth interrupt, you will present the OAuth URL to the user, and wait for them to finishe the OAuth dance before resolving the interrupt with `{authorized: true}` or `{authorized: false}` if an error occurred:

````typescript
async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}
````

### Create an Agent instance

Here you create the agent using the `createAgent` function. You pass the system prompt, the model, the tools, and the checkpointer. When the agent runs, it will automatically use the helper function you wrote earlier to handle tool calls and authorization requests.

````typescript
const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});
````

### Write the invoke helper

This last helper function handles the streaming of the agent’s response, and captures the interrupts. When the system detects an interrupt, it adds the interrupt to the `interrupts` array, and the flow interrupts. If there are no interrupts, it will just stream the agent’s to your console.

````typescript
async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}
````

### Write the main function

Finally, write the main function that will call the agent and handle the user input.

Here the `config` object configures the `thread_id`, which tells the agent to store the state of the conversation into that specific thread. Like any typical agent loop, you:

1. Capture the user input
2. Stream the agent's response
3. Handle any authorization interrupts
4. Resume the agent after authorization
5. Handle any errors
6. Exit the loop if the user wants to quit

````typescript
async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));
````

## Running the Agent

### Run the agent

```bash
bun run main.ts
```

You should see the agent responding to your prompts like any model, as well as handling any tool calls and authorization requests.

## Next Steps

- Clone the [repository](https://github.com/arcade-agents/ts-langchain-Youtube) and run it
- Add more toolkits to the `toolkits` array to expand capabilities
- Customize the `systemPrompt` to specialize the agent's behavior
- Explore the [Arcade documentation](https://docs.arcade.dev) for available toolkits

