---
name: proposal-review
description: Review a proposal
variables:
  proposalId:
    type: string
    required: true
    description: Proposal identifier
  reviewer:
    type: string
    required: false
    description: Assigned reviewer
---

Review proposal {{proposalId}}

{{#if reviewer}}
Assigned to {{reviewer}}.
{{/if}}
