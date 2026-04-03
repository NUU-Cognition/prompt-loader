---
name: basic
description: Basic interpolation and optional identity clause
variables:
  sessionId:
    type: string
    required: true
    description: The session identifier
  person:
    type: string
    required: false
    description: Optional person identity
---

You are a headless Flint agent.
Your session ID is {{sessionId}}

{{#if person}}
You are acting on behalf of @"Mesh/People/{{person}}.md"
{{/if}}
