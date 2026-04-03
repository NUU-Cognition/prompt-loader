---
name: standalone
description: Standalone consumer fixture
variables:
  tool:
    type: string
    required: true
    description: Tool name
  enabled:
    type: boolean
    required: false
    description: Whether the feature is enabled
---

Tool: {{tool}}
{{#if enabled}}
Feature enabled
{{/if}}
