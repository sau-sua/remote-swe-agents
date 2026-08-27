'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { GitHubAccount } from '@remote-swe-agents/agent-core/schema';
import { useRouter } from 'next/navigation';
import {
  deleteGitHubAccountAction,
  setDefaultGitHubAccountAction,
  upsertGitHubAccountAction,
} from '../github-account-actions';

type GitHubAccountsFormProps = {
  accounts: GitHubAccount[];
  defaultGithubAccountId: string;
};

type FormState = {
  id?: string;
  name: string;
  gitUserName: string;
  gitUserEmail: string;
  personalAccessToken: string;
  isDefault: boolean;
};

const emptyForm = (makeDefault: boolean): FormState => ({
  name: '',
  gitUserName: '',
  gitUserEmail: '',
  personalAccessToken: '',
  isDefault: makeDefault,
});

export default function GitHubAccountsForm({ accounts, defaultGithubAccountId }: GitHubAccountsFormProps) {
  const t = useTranslations('preferences.githubAccounts');
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm(accounts.length === 0));
  const isEditing = Boolean(form.id);

  const { execute: upsert, isPending: isSaving } = useAction(upsertGitHubAccountAction, {
    onSuccess: () => {
      toast.success(isEditing ? t('updateSuccess') : t('createSuccess'));
      setForm(emptyForm(false));
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || (isEditing ? t('updateError') : t('createError')));
    },
  });

  const { execute: remove, isPending: isDeleting } = useAction(deleteGitHubAccountAction, {
    onSuccess: () => {
      toast.success(t('deleteSuccess'));
      setForm(emptyForm(false));
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || t('deleteError'));
    },
  });

  const { execute: setDefault, isPending: isSettingDefault } = useAction(setDefaultGitHubAccountAction, {
    onSuccess: () => {
      toast.success(t('defaultUpdated'));
      router.refresh();
    },
    onError: () => {
      toast.error(t('updateError'));
    },
  });

  const isPending = isSaving || isDeleting || isSettingDefault;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    upsert({
      id: form.id,
      name: form.name,
      gitUserName: form.gitUserName,
      gitUserEmail: form.gitUserEmail,
      personalAccessToken: form.personalAccessToken || undefined,
      isDefault: form.isDefault,
    });
  };

  return (
    <div className="space-y-6">
      {accounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('listTitle')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || !defaultGithubAccountId}
              onClick={() => setDefault({ id: '' })}
            >
              {t('useCdkDefault')}
            </Button>
          </div>
          {accounts.map((account) => {
            const isDefault = defaultGithubAccountId === account.SK;
            return (
              <div
                key={account.SK}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-gray-900 dark:text-white">{account.name}</h3>
                    {isDefault && (
                      <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                        {t('defaultBadge')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {account.gitUserName} &lt;{account.gitUserEmail}&gt;
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {!isDefault && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setDefault({ id: account.SK })}
                    >
                      {t('setDefault')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      setForm({
                        id: account.SK,
                        name: account.name,
                        gitUserName: account.gitUserName,
                        gitUserEmail: account.gitUserEmail,
                        personalAccessToken: '',
                        isDefault,
                      })
                    }
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      if (confirm(t('deleteConfirm'))) {
                        remove({ id: account.SK });
                      }
                    }}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isEditing ? t('editTitle') : t('createTitle')}
        </h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('name')}</label>
          <Input
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder={t('namePlaceholder')}
            disabled={isPending}
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('gitUserName')}
            </label>
            <Input
              value={form.gitUserName}
              onChange={(e) => setForm((current) => ({ ...current, gitUserName: e.target.value }))}
              placeholder={t('gitUserNamePlaceholder')}
              disabled={isPending}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('gitUserEmail')}
            </label>
            <Input
              type="email"
              value={form.gitUserEmail}
              onChange={(e) => setForm((current) => ({ ...current, gitUserEmail: e.target.value }))}
              placeholder={t('gitUserEmailPlaceholder')}
              disabled={isPending}
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('pat')}</label>
          <Input
            type="password"
            autoComplete="off"
            value={form.personalAccessToken}
            onChange={(e) => setForm((current) => ({ ...current, personalAccessToken: e.target.value }))}
            placeholder={isEditing ? t('patUpdatePlaceholder') : t('patPlaceholder')}
            disabled={isPending}
            required={!isEditing}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('patDescription')}</p>
        </div>
        <div className="flex items-center space-x-3">
          <Checkbox
            id="githubAccountIsDefault"
            checked={form.isDefault}
            onCheckedChange={(checked) => setForm((current) => ({ ...current, isDefault: !!checked }))}
            disabled={isPending}
          />
          <label htmlFor="githubAccountIsDefault" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('setAsDefault')}
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? t('saving') : isEditing ? t('save') : t('add')}
          </Button>
          {isEditing && (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setForm(emptyForm(false))}>
              {t('cancel')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
