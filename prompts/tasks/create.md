---
name: task-create
description: Create a task prompt
variables:
  title:
    type: string
    required: true
    description: Task title
  owner:
    type: string
    required: false
    description: Optional owner
---

Create task: {{title}}

{{#if owner}}
Assign to {{owner}}.
{{/if}}
