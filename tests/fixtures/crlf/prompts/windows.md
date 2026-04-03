---
name: windows
description: Windows-authored prompt
variables:
  sessionId:
    type: string
    required: true
    description: Session identifier
  owner:
    type: string
    description: Prompt owner
---

Windows session: {{sessionId}}
{{#if owner}}Owner: {{owner}}{{else}}Owner: unassigned{{/if}}
