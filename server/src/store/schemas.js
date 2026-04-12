export const checkpointBodySchema = {
  type: 'object',
  required: ['workflow_id', 'step', 'state'],
  additionalProperties: false,
  properties: {
    workflow_id: { type: 'string', minLength: 1, maxLength: 128 },
    step: { type: 'integer', minimum: 0 },
    label: { type: 'string', maxLength: 256 },
    state: { type: 'object' },
    agent_id: { type: 'string', maxLength: 255 },
    metadata: { type: 'object' },
  },
};

export const checkpointResponseSchema = {
  type: 'object',
  properties: {
    checkpoint_id: { type: 'string' },
    workflow_id: { type: 'string' },
    step: { type: 'integer' },
    etag: { type: 'string' },
    created_at: { type: 'string' },
    diff_from_previous: {
      type: 'object',
      properties: {
        added: { type: 'array', items: { type: 'string' } },
        removed: { type: 'array', items: { type: 'string' } },
        changed: { type: 'array', items: { type: 'string' } },
      },
    },
    size_bytes: { type: 'integer' },
  },
};

export const webhookBodySchema = {
  type: 'object',
  required: ['url', 'events'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', format: 'uri', maxLength: 2048 },
    events: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: ['checkpoint.saved', 'workflow.resumed', 'workflow.expired'],
      },
    },
    secret: { type: 'string', maxLength: 256 },
  },
};

export const replayQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from_step: { type: 'integer', minimum: 0 },
    to_step: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
  },
};
