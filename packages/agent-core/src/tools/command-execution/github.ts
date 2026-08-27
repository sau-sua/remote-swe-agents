import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { getGitHubAccount, getGitHubAccountToken } from '../../lib/github-account';
import { SessionItem } from '../../schema';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const cache = {
  updatedAt: 0,
  token: '',
};

export const isGitHubConfigured = () => {
  return !!(
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN ||
    (process.env.GITHUB_APP_PRIVATE_KEY_PATH && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_INSTALLATION_ID)
  );
};

export const resetGitHubAuthCache = () => {
  cache.updatedAt = 0;
  cache.token = '';
};

export const applyGitIdentity = async (name: string, email: string): Promise<void> => {
  await execFileAsync('git', ['config', '--global', 'user.name', name]);
  await execFileAsync('git', ['config', '--global', 'user.email', email]);
};

/**
 * Switch this worker process to a session-specific GitHub PAT and git identity.
 * When the session has no named account, the CDK-configured default PAT is kept.
 */
export const applyGitHubCredentialsForSession = async (session: SessionItem | undefined): Promise<void> => {
  if (!session?.githubAccountId) {
    return;
  }

  const account = await getGitHubAccount(session.githubAccountId);
  if (!account) {
    console.warn(`GitHub account ${session.githubAccountId} was not found; using the default PAT from the environment`);
    return;
  }

  const token = await getGitHubAccountToken(account.SK);
  if (!token) {
    console.warn(`GitHub PAT for account "${account.name}" was not found in SSM; using the default PAT`);
    return;
  }

  resetGitHubAuthCache();
  process.env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
  await applyGitIdentity(account.gitUserName, account.gitUserEmail);
  console.log(`Using GitHub account "${account.name}" (${account.gitUserEmail}) for this session`);
};

export const buildGhLoginEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { GITHUB_TOKEN, GH_TOKEN, ...rest } = env;
  return rest;
};

const GH_LOGIN_TIMEOUT_MS = 10_000;

const loginGhWithToken = (token: string, env: NodeJS.ProcessEnv): Promise<void> => {
  return new Promise((resolve, reject) => {
    const loginEnv = buildGhLoginEnv(env);
    const proc = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--with-token'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: loginEnv,
    });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`gh auth login timed out after ${GH_LOGIN_TIMEOUT_MS}ms`));
    }, GH_LOGIN_TIMEOUT_MS);
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`gh auth login failed (code ${code}): ${stderr}`));
    });
    proc.stdin.write(token);
    proc.stdin.end();
  });
};

export const authorizeGitHubCli = async () => {
  if (cache.updatedAt > Date.now() - 50 * 60 * 1000) {
    return cache.token;
  }
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    cache.token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  } else if (
    process.env.GITHUB_APP_PRIVATE_KEY_PATH &&
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_INSTALLATION_ID
  ) {
    console.log(`refreshing token...`);
    const { stdout } = await execAsync(
      `gh-token generate --key ${process.env.GITHUB_APP_PRIVATE_KEY_PATH} --app-id ${process.env.GITHUB_APP_ID} --installation-id ${process.env.GITHUB_APP_INSTALLATION_ID}`
    );
    const token = JSON.parse(stdout).token;
    if (!token) {
      throw new Error('Failed to get GitHub token');
    }
    cache.token = token;
  } else {
    return undefined;
  }

  const authEnv = {
    ...process.env,
    GITHUB_TOKEN: cache.token,
  };

  await execAsync(`gh auth setup-git`, { env: authEnv });

  await loginGhWithToken(cache.token, authEnv);

  cache.updatedAt = Date.now();
  return cache.token;
};
