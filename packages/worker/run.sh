#!/bin/bash
# runner script for AgentCore Runtime
# dependencies:
#   - aws cli

if [ -n "$GITHUB_APP_PRIVATE_KEY_PARAMETER_NAME" ]; then
    aws ssm get-parameter \
        --name $GITHUB_APP_PRIVATE_KEY_PARAMETER_NAME \
        --region ${AWS_REGION} \
        --with-decryption \
        --query "Parameter.Value" \
        --output text > /opt/private-key.pem
    export GITHUB_APP_PRIVATE_KEY_PATH="/opt/private-key.pem"
fi

if [ -n "$GITHUB_PERSONAL_ACCESS_TOKEN_PARAMETER_NAME" ]; then
    export GITHUB_PERSONAL_ACCESS_TOKEN=$(aws ssm get-parameter --name $GITHUB_PERSONAL_ACCESS_TOKEN_PARAMETER_NAME --region ${AWS_REGION} --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
fi

if [ -n "$SLACK_BOT_TOKEN_PARAMETER_NAME" ]; then
  export SLACK_BOT_TOKEN=$(aws ssm get-parameter --name $SLACK_BOT_TOKEN_PARAMETER_NAME --region ${AWS_REGION} --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
fi

# Ensure uv/uvx (installed to ~/.local/bin) stay on PATH even if the runtime resets it.
export PATH="${HOME}/.local/bin:/root/.local/bin:${PATH}"

exec npx tsx src/agent-core.ts
