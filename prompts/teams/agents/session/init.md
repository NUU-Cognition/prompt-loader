---
name: team-agent-session-init
description: Initialize an agent session
variables:
  agent:
    type: string
    required: true
    description: Agent name
  verbose:
    type: boolean
    required: false
    description: Enable verbose output
---

Initialize {{agent}}

{{#if verbose}}
Verbose logging enabled.
{{/if}}
