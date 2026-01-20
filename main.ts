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

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



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

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

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