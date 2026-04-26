# MCP Server

Implementation of the Model Context Protocol server exposing local tools to Claude.

## Boundaries
- Tools defined here are pure: input validation → action → typed output.
- No UI concerns. No direct rendering.
- Errors are returned as structured tool errors, never thrown to the caller.