# Visual replies

Agents can answer with an interactive page: a chart, table, diagram, image collage, or mockup. Ask for one and the agent builds a self-contained HTML page that appears in the thread above its written reply. Every provider can publish pages.

Pages use your current theme and fonts, including custom themes, and follow light and dark mode as you switch. Scripts run inside the page, sandboxed away from Ronin and your session. Links you click open in your browser. Use **Expand page** to see a larger view, inspect its source, or save it. Close the expanded view to return to the thread.

Pages normally grow to fit their content as the thread width changes, up to 2,000 pixels. Agents can choose a shorter, scrollable frame for long pages. Automatic sizing works without a preview host.

Agents can place local images in a page by absolute file path. Ronin embeds them when the page is published, so it keeps working after the original files move or disappear. Deleting the thread deletes its own pages; deleting a fork preserves the source thread's pages.

Before publishing, agents can use **html_preview** to check a screenshot, content height, and console output. Preview uses a temporary background tab in a connected Ronin desktop client and closes it afterward. It preserves the agent's current browser tab. Publishing works without a preview host. Pages and their images also work when the environment is remote.

## MCP apps

Some MCP servers return interactive apps with their tool results. Codex can show these apps directly in the thread using the MCP servers configured on the environment. Other providers show ordinary tool results.

An app follows your theme and can read resources or call tools on its own server. Ronin asks before tool calls that the server does not mark read-only, before sending a chat message, and before saving a download. App messages leave your composer draft intact. Apps can request full screen; Escape outside the app or a new approval or question returns the app to the thread.

Saved apps remain viewable after their agent stops. Interactions need the app's original Codex session running; opening the app never starts an agent. An app can keep a note about its current state, such as a selected filter, for your next message. Each update replaces its previous note. Removing the app's history removes that note. Deleting the thread removes its own app documents.
