from arcadepy import AsyncArcade
from dotenv import load_dotenv
from google.adk import Agent, Runner
from google.adk.artifacts import InMemoryArtifactService
from google.adk.models.lite_llm import LiteLlm
from google.adk.sessions import InMemorySessionService, Session
from google_adk_arcade.tools import get_arcade_tools
from google.genai import types
from human_in_the_loop import auth_tool, confirm_tool_usage

import os

load_dotenv(override=True)


async def main():
    app_name = "my_agent"
    user_id = os.getenv("ARCADE_USER_ID")

    session_service = InMemorySessionService()
    artifact_service = InMemoryArtifactService()
    client = AsyncArcade()

    agent_tools = await get_arcade_tools(
        client, toolkits=["Youtube"]
    )

    for tool in agent_tools:
        await auth_tool(client, tool_name=tool.name, user_id=user_id)

    agent = Agent(
        model=LiteLlm(model=f"openai/{os.environ["OPENAI_MODEL"]}"),
        name="google_agent",
        instruction="# AI Video Search Agent

## Introduction
This AI Video Search Agent is designed to help users discover relevant YouTube videos based on specific keywords or queries. It can also retrieve detailed information about any specific video using its video ID. The agent leverages advanced search capabilities to provide a tailored video experience for users.

## Instructions
1. **User Input**: Begin by gathering relevant keywords or phrases from the user that describe the type of videos they wish to find.
2. **Search for Videos**: Use the `Youtube_SearchForVideos` tool to search for videos based on the user’s input.
3. **Display Results**: Show the search results to the user, including video titles, thumbnails, and links.
4. **Video Details**: If the user wants more information about a particular video, collect the video ID and use the `Youtube_GetYoutubeVideoDetails` tool to retrieve details.
5. **Provide Information**: Present detailed information about the selected video, such as the description, view count, and upload date.
6. **Follow-Up**: Ask the user if they want to search for more videos or retrieve details about another video.

## Workflows
### Workflow 1: Search for Videos
1. User inputs keywords for the video search.
2. Use `Youtube_SearchForVideos` with the provided keywords.
3. Present the search results to the user.

### Workflow 2: Retrieve Video Details
1. User selects a video from the search results.
2. Collect the video ID from the selected video.
3. Use `Youtube_GetYoutubeVideoDetails` with the collected video ID.
4. Present the details of the selected video to the user.
  
### Workflow 3: User Interaction
1. After providing results or video details, ask the user if they want to search for more videos or get details about another video.
2. Depending on the user's response, either repeat Workflow 1 or Workflow 2.",
        description="An agent that uses Youtube tools provided to perform any task",
        tools=agent_tools,
        before_tool_callback=[confirm_tool_usage],
    )

    session = await session_service.create_session(
        app_name=app_name, user_id=user_id, state={
            "user_id": user_id,
        }
    )
    runner = Runner(
        app_name=app_name,
        agent=agent,
        artifact_service=artifact_service,
        session_service=session_service,
    )

    async def run_prompt(session: Session, new_message: str):
        content = types.Content(
            role='user', parts=[types.Part.from_text(text=new_message)]
        )
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=content,
        ):
            if event.content.parts and event.content.parts[0].text:
                print(f'** {event.author}: {event.content.parts[0].text}')

    while True:
        user_input = input("User: ")
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        await run_prompt(session, user_input)


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())