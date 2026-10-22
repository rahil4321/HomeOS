"""Manual MCP smoke test for the three judge-demo outcomes.

Start server.py in another terminal, then run: python test_client.py
"""
import asyncio
from fastmcp import Client

CASES = [
    ("Routine package delivery", {
        "current_state": "FOCUS",
        "incoming_event": "Amazon delivery driver dropped a package.",
        "urgency_score": 4,
    }),
    ("Critical alarm", {
        "current_state": "FOCUS",
        "incoming_event": "Smoke alarm detected smoke in the kitchen.",
        "urgency_score": 9,
    }),
    ("Trivial background update", {
        "current_state": "FOCUS",
        "incoming_event": "Routine weather update: sunny this afternoon.",
        "urgency_score": 1,
    }),
]


async def main() -> None:
    print("Connecting to HomeOS MCP server at http://localhost:8000/mcp")
    async with Client("http://localhost:8000/mcp") as client:
        for label, arguments in CASES:
            print(f"\n--- {label} ---")
            result = await client.call_tool("evaluate_interruption", arguments)
            print(result)


if __name__ == "__main__":
    asyncio.run(main())
