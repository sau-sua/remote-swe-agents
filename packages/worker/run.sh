#!/bin/bash
# runner script for AgentCore Runtime
# dependencies:
#   - aws cli

if [ -n "$GITHUB_APP_PRIVATE_KEY_PARAMETER_NAME" ]; then
    aws ssm get-parameter \
        --name $GITHUB_APP_PRIVATE_KEY_PARAMETER_NAME \
        --with-decryption \
        --region ${AWS_REGION} \
        --query "Parameter.Value" \
        --output text > /opt/private-key.pem
    export GITHUB_APP_PRIVATE_KEY_PATH="/opt/private-key.pem"
fi

if [ -n "$GITHUB_PERSONAL_ACCESS_TOKEN_PARAMETER_NAME" ]; then
    export GITHUB_PERSONAL_ACCESS_TOKEN=$(aws ssm get-parameter --name $GITHUB_PERSONAL_ACCESS_TOKEN_PARAMETER_NAME --with-decryption --region ${AWS_REGION} --query "Parameter.Value" --output text 2>/dev/null || echo "")
fi

if [ -n "$SLACK_BOT_TOKEN_PARAMETER_NAME" ]; then
  export SLACK_BOT_TOKEN=$(aws ssm get-parameter --name $SLACK_BOT_TOKEN_PARAMETER_NAME --with-decryption --region ${AWS_REGION} --query "Parameter.Value" --output text 2>/dev/null || echo "")
fi

exec npx tsx src/agent-core.ts
