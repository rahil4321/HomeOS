# HomeOS — AI-Powered Semantic Interruption Router

**Making smart homes understand when a notification deserves your attention.**

HomeOS is an AI-powered smart-home interruption routing system designed to make notifications more context-aware. Instead of treating every event as equally important, HomeOS aims to interpret what is happening and determine whether it deserves an immediate interruption, a visual notification, or no interruption at all.

The goal is simple: **deliver the right information, through the right channel, at the right time.**

---
## Demo

🎬 **[Watch the HomeOS Demo on YouTube](https://youtu.be/Su4JKNtU-Qo)**

Watch HomeOS demonstrate AI-powered semantic interruption routing, with decisions designed to distinguish urgent events from non-urgent and irrelevant notifications.

## The Problem

Traditional smart-home notifications often follow a simple rule: an event happens, and the user gets notified.

But not every event deserves the same level of attention.

- An urgent situation may require an immediate interruption.
- A useful but non-urgent update may only need a visual notification.
- An irrelevant or low-priority event may not need to interrupt the user at all.

Treating all these events equally creates unnecessary interruptions and makes genuinely important notifications easier to overlook.

## The Solution

HomeOS introduces a semantic interruption-routing approach. It is designed to interpret incoming events in context and classify how they should reach the user.

### The Three Routing Decisions

| Decision | Meaning |
|---|---|
| `INTERRUPT` | Deliver the event as an immediate, attention-worthy interruption. |
| `VISUAL_ONLY` | Keep the information available visually without demanding immediate attention. |
| `IGNORE` | Suppress an event that does not warrant an interruption. |

These decisions form the core interaction model of HomeOS.

Rather than asking only *“Did something happen?”*, the system focuses on *“Does this deserve the user's attention right now?”*

---

## How It Works

At a high level, HomeOS connects an event-processing backend, AI-powered decision logic, and a frontend interface.

1. **Event input:** An event or request enters the system.
2. **Interpretation:** The backend processes the input and applies the project's decision logic.
3. **Routing decision:** The system determines the appropriate interruption category.
4. **User-facing output:** The result can be inspected through the HomeOS interface and, where configured, integrated with Alexa.
5. **Visibility:** The frontend provides a place to interact with and observe the system.

The intended outcome is a more selective notification experience in which urgency and relevance matter more than notification volume.

## Architecture

```text
                Incoming Event
                       |
                       v
             +-------------------+
             |   FastAPI Backend |
             +-------------------+
                       |
                       v
             +-------------------+
             | AI / Decision     |
             | Logic             |
             +-------------------+
                       |
                       v
             +-------------------+
             | Interruption      |
             | Classification    |
             +-------------------+
                       |
             +---------+---------+
             |         |         |
             v         v         v
         INTERRUPT  VISUAL_ONLY  IGNORE
             |         |         |
             +---------+---------+
                       |
                       v
             +-------------------+
             | Frontend /        |
             | Configured Output |
             +-------------------+
```

*Conceptual architecture. The exact processing path depends on the enabled integration and implementation.*

### Technology Stack

- **Python** — backend implementation
- **FastAPI** — HTTP API and request handling
- **Next.js** — frontend application
- **React and TypeScript** — frontend components and application logic
- **Groq API** — AI model access, where configured
- **Alexa integration** — voice interaction through an Alexa-hosted skill configuration and the backend endpoint

---

## Project Structure

```text
HomeOS/
├── backend/
│   ├── server.py
│   ├── requirements.txt
│   ├── test_client.py
│   └── test_server.py
├── frontend/
│   ├── src/
│   │   └── app/
│   ├── public/
│   ├── package.json
│   └── next.config.ts
├── .gitignore
└── README.md
```

The backend contains the server and test files. The frontend contains the Next.js application, UI components, and API routes.

---

## Getting Started

### Prerequisites

Install the following before running the project:

- Python 3.10 or newer
- Node.js and npm
- A Groq API key if your configured backend uses Groq
- An Amazon Developer account and configured Alexa skill if you want to test the Alexa integration

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd HomeOS
```

Replace `YOUR_GITHUB_REPOSITORY_URL` with the repository's actual clone URL.

### 2. Set Up the Backend

```bash
cd backend

python3 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
pip install -r requirements.txt
```

Configure the environment variables required by the backend. Keep your real API keys in a local environment file and never commit them to Git.

For example, if the backend expects `GROQ_API_KEY`, add it to `backend/.env`:

```dotenv
GROQ_API_KEY=your_groq_api_key_here
```

Use the exact environment-variable names expected by the current source code. The example above is a placeholder, not a real credential.

Start the backend:

```bash
python server.py
```

If the server starts successfully on port `8000`, the backend should be reachable at:

```text
http://localhost:8000
```

### 3. Set Up the Frontend

Open a second terminal from the repository root:

```bash
cd frontend
npm install
```

Configure any required frontend environment variables using the names expected by the application. For local Next.js development, these are commonly stored in `frontend/.env.local`.

Start the development server:

```bash
npm run dev
```

Open the local frontend at:

**http://localhost:3000**

Keep both development servers running while testing the complete application.

---

## Alexa Integration

HomeOS includes an Alexa integration path through its backend.

To test it:

1. Create and configure the corresponding Alexa skill in the Amazon Developer Console.
2. Configure the skill's request endpoint to point to the publicly reachable HTTPS backend endpoint required by Alexa.
3. Ensure the backend is running and its request-verification configuration is correct.
4. Test the skill through the Alexa developer testing interface and inspect the backend logs.

For local development, a temporary HTTPS tunnel can expose the backend. For example, with Cloudflare Tunnel installed:

```bash
cloudflared tunnel --url http://localhost:8000
```

Use the HTTPS URL generated by the tunnel, together with the backend's configured Alexa route. A temporary tunnel URL changes when a new tunnel session is created, so it should not be treated as a permanent deployment URL.

**Security note:** Do not expose development credentials, API keys, or debugging endpoints publicly. Use appropriate request verification and production configuration before deploying the service.

---

## Testing

The repository includes backend test files:

```text
backend/test_client.py
backend/test_server.py
```

Run the test suite using the project's configured test runner. If `pytest` is installed, try:

```bash
cd backend
python -m pytest -v
```

Use the test results to verify the current implementation before relying on it in a deployment.

---

## Configuration and Security

Before running or deploying HomeOS:

- Keep API keys and credentials out of source code.
- Never commit `.env`, `.env.local`, or other files containing real secrets.
- Store placeholders, not real credentials, in any shared example configuration.
- Verify the environment-variable names against the current source code.
- Keep dependencies installed in a virtual environment.
- Do not assume that a successful local test guarantees a working Alexa integration or production deployment.

---

## Current Scope

HomeOS is a development project exploring context-aware interruption routing for smart-home interactions.

The central concept is the distinction between:

- **Urgent information** that deserves immediate attention
- **Non-urgent information** that can remain visible
- **Low-value information** that should not create another interruption

The repository provides the application code and integration paths for exploring this approach. Available behavior depends on the current implementation and configuration.

---

## Future Directions

Potential areas for further development include:

- Richer contextual reasoning using recent events and user-defined priorities
- Configurable routing policies for different situations
- More smart-home event sources and device integrations
- Improved observability and explanations for routing decisions
- Persistent preferences and personalization
- Automated integration testing and production deployment

These are possible extensions, not claims that every feature is already implemented.

---

## Why HomeOS?

As connected devices become more common, the challenge is no longer just collecting information. It is deciding which information deserves our attention.

HomeOS explores a different approach to smart-home notifications: **less noise, more context, and more intentional interruptions.**

---

## Contributing

Contributions, bug reports, and suggestions are welcome.

If you would like to contribute:

1. Fork the repository.
2. Create a branch for your change.
3. Make and test your changes.
4. Open a pull request describing the improvement.

Please do not include API keys, private credentials, or personal data in issues, commits, or pull requests.

---

## License

No license has been specified yet. Until a license is added to the repository, assume that standard copyright restrictions apply and check with the repository owner before reusing or distributing the code.
