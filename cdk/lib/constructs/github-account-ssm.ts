import { Stack } from 'aws-cdk-lib';
import { IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export const GITHUB_ACCOUNT_SSM_PREFIX = '/remote-swe/github/accounts';

export const githubAccountParameterArn = (stack: Stack): string =>
  `arn:${stack.partition}:ssm:${stack.region}:${stack.account}:parameter${GITHUB_ACCOUNT_SSM_PREFIX}/*`;

export const grantGitHubAccountParameters = (grantee: IGrantable, stack: Stack, actions: string[]) => {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions,
      resources: [githubAccountParameterArn(stack)],
    })
  );
};
