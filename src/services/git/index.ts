import { dialog, ipcMain, net, shell } from 'electron';
import { getRemoteName, getRemoteUrl, GitStep, ModifiedFileList } from 'git-sync-js';
import { inject, injectable } from 'inversify';
import { compact } from 'lodash';
import { ModuleThread, spawn, Worker } from 'threads';

import { WikiChannel } from '@/constants/channels';
import type { IAuthenticationService, ServiceBranchTypes } from '@services/auth/interface';
import { i18n } from '@services/libs/i18n';
import { logger } from '@services/libs/log';
import type { INativeService } from '@services/native/interface';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IViewService } from '@services/view/interface';
import type { IWikiService } from '@services/wiki/interface';
import type { IWindowService } from '@services/windows/interface';
import { Observer } from 'rxjs';
import { GitWorker } from './gitWorker';
import { ICommitAndSyncConfigs, IGitLogMessage, IGitService, IGitUserInfos } from './interface';

import { LOCAL_GIT_DIRECTORY } from '@/constants/appPaths';
import { githubDesktopUrl } from '@/constants/urls';
import { lazyInject } from '@services/container';
import { WindowNames } from '@services/windows/WindowProperties';
import { IWorkspace } from '@services/workspaces/interface';
// @ts-expect-error it don't want .ts
// eslint-disable-next-line import/no-webpack-loader-syntax
import workerURL from 'threads-plugin/dist/loader?name=gitWorker!./gitWorker.ts';
import { stepWithChanges } from './stepWithChanges';

@injectable()
export class Git implements IGitService {
  @lazyInject(serviceIdentifier.Authentication)
  private readonly authService!: IAuthenticationService;

  @lazyInject(serviceIdentifier.Wiki)
  private readonly wikiService!: IWikiService;

  @lazyInject(serviceIdentifier.Window)
  private readonly windowService!: IWindowService;

  @lazyInject(serviceIdentifier.View)
  private readonly viewService!: IViewService;

  @lazyInject(serviceIdentifier.NativeService)
  private readonly nativeService!: INativeService;

  private gitWorker?: ModuleThread<GitWorker>;

  constructor(@inject(serviceIdentifier.Preference) private readonly preferenceService: IPreferenceService) {
    void this.initWorker();
  }

  private async initWorker(): Promise<void> {
    process.env.LOCAL_GIT_DIRECTORY = LOCAL_GIT_DIRECTORY;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.gitWorker = await spawn<GitWorker>(new Worker(workerURL), { timeout: 1000 * 60 });
  }

  public async getModifiedFileList(wikiFolderPath: string): Promise<ModifiedFileList[]> {
    const list = await this.gitWorker?.getModifiedFileList(wikiFolderPath);
    return list ?? [];
  }

  public async getWorkspacesRemote(wikiFolderPath?: string): Promise<string | undefined> {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!wikiFolderPath) return;
    const branch = (await this.authService.get('git-branch' as ServiceBranchTypes)) ?? 'main';
    const defaultRemoteName = (await getRemoteName(wikiFolderPath, branch)) ?? 'origin';
    const remoteUrl = await getRemoteUrl(wikiFolderPath, defaultRemoteName);
    return remoteUrl;
  }

  /**
   * @param {string} githubRepoName similar to "linonetwo/wiki", string after "https://com/"
   */
  public async updateGitInfoTiddler(workspace: IWorkspace, githubRepoName: string): Promise<void> {
    const browserViews = await this.viewService.getActiveBrowserViews();
    if (compact(browserViews).length === 0) {
      logger.error('no browserView in updateGitInfoTiddler');
      return;
    }
    await Promise.all(
      browserViews.map(async (browserView) => {
        if (browserView !== undefined) {
          const tiddlerText = await this.wikiService.getTiddlerText(workspace, '$:/GitHub/Repo');
          if (tiddlerText !== githubRepoName) {
            await new Promise<void>((resolve) => {
              browserView.webContents.send(WikiChannel.addTiddler, '$:/GitHub/Repo', githubRepoName, {
                type: 'text/vnd.tiddlywiki',
              });
              ipcMain.once(WikiChannel.addTiddlerDone, () => {
                resolve();
              });
            });
          }
        }
      }),
    );
  }

  private translateMessage(message: string): string {
    switch (message) {
      case GitStep.StartGitInitialization: {
        return i18n.t('Log.StartGitInitialization');
      }
      case GitStep.GitRepositoryConfigurationFinished: {
        return i18n.t('Log.GitRepositoryConfigurationFinished');
      }
      case GitStep.StartConfiguringGithubRemoteRepository: {
        return i18n.t('Log.StartConfiguringGithubRemoteRepository');
      }
      case GitStep.StartBackupToGitRemote: {
        return i18n.t('Log.StartBackupToGithubRemote');
      }
      case GitStep.PrepareCloneOnlineWiki: {
        return i18n.t('Log.PrepareCloneOnlineWiki');
      }
      case GitStep.PrepareSync: {
        return i18n.t('Log.PrepareSync');
      }
      case GitStep.HaveThingsToCommit: {
        return i18n.t('Log.HaveThingsToCommit');
      }
      case GitStep.AddingFiles: {
        return i18n.t('Log.AddingFiles');
      }
      case GitStep.AddComplete: {
        return i18n.t('Log.AddComplete');
      }
      case GitStep.CommitComplete: {
        return i18n.t('Log.CommitComplete');
      }
      case GitStep.PreparingUserInfo: {
        return i18n.t('Log.PreparingUserInfo');
      }
      case GitStep.FetchingData: {
        return i18n.t('Log.FetchingData');
      }
      case GitStep.NoNeedToSync: {
        return i18n.t('Log.NoNeedToSync');
      }
      case GitStep.LocalAheadStartUpload: {
        return i18n.t('Log.LocalAheadStartUpload');
      }
      case GitStep.CheckingLocalSyncState: {
        return i18n.t('Log.CheckingLocalSyncState');
      }
      case GitStep.CheckingLocalGitRepoSanity: {
        return i18n.t('Log.CheckingLocalGitRepoSanity');
      }
      case GitStep.LocalStateBehindSync: {
        return i18n.t('Log.LocalStateBehindSync');
      }
      case GitStep.LocalStateDivergeRebase: {
        return i18n.t('Log.LocalStateDivergeRebase');
      }
      case GitStep.RebaseResultChecking: {
        return i18n.t('Log.CheckingRebaseStatus');
      }
      case GitStep.RebaseConflictNeedsResolve: {
        return i18n.t('Log.RebaseConflictNeedsResolve');
      }
      case GitStep.RebaseSucceed: {
        return i18n.t('Log.RebaseSucceed');
      }
      case GitStep.GitPushFailed: {
        return i18n.t('Log.GitPushFailed');
      }
      case GitStep.GitMergeFailed: {
        return i18n.t('Log.GitMergeFailed');
      }
      case GitStep.SyncFailedAlgorithmWrong: {
        return i18n.t('Log.SyncFailedSystemError');
      }
      case GitStep.PerformLastCheckBeforeSynchronizationFinish: {
        return i18n.t('Log.PerformLastCheckBeforeSynchronizationFinish');
      }
      case GitStep.SynchronizationFinish: {
        return i18n.t('Log.SynchronizationFinish');
      }
      case GitStep.StartFetchingFromGithubRemote: {
        return i18n.t('Log.StartFetchingFromGithubRemote');
      }
      case GitStep.CantSyncInSpecialGitStateAutoFixSucceed: {
        return i18n.t('Log.CantSyncInSpecialGitStateAutoFixSucceed');
      }
      default: {
        return message;
      }
    }
  }

  private getErrorMessageI18NDict() {
    return {
      AssumeSyncError: i18n.t('Log.SynchronizationFailed'),
      SyncParameterMissingError: i18n.t('Log.GitTokenMissing'), // + error.parameterName,
      GitPullPushError: i18n.t('Log.SyncFailedSystemError'),
      CantSyncGitNotInitializedError: i18n.t('Log.CantSyncGitNotInitialized'),
      SyncScriptIsInDeadLoopError: i18n.t('Log.CantSynchronizeAndSyncScriptIsInDeadLoop'),
      CantSyncInSpecialGitStateAutoFixFailed: i18n.t('Log.CantSyncInSpecialGitStateAutoFixFailed'),
    };
  }

  private popGitErrorNotificationToUser(step: GitStep, message: string): void {
    if (step === GitStep.GitPushFailed && message.includes('403')) {
      const mainWindow = this.windowService.get(WindowNames.main);
      if (mainWindow !== undefined) {
        void dialog.showMessageBox(mainWindow, {
          title: i18n.t('Log.GitTokenMissing'),
          message: `${i18n.t('Log.GitTokenExpireOrWrong')} (${message})`,
          buttons: ['OK'],
          cancelId: 0,
          defaultId: 0,
        });
      }
    }
  }

  /**
   * Handle common error dialog and message dialog
   */
  private readonly getWorkerMessageObserver = (wikiFolderPath: string, resolve: () => void, reject: (error: Error) => void): Observer<IGitLogMessage> => ({
    next: (messageObject) => {
      if (messageObject.level === 'error') {
        this.createFailedDialog((messageObject.error).message, wikiFolderPath);
        return;
      }
      const { message, meta, level } = messageObject;
      if (typeof meta === 'object' && meta !== null && 'step' in meta) {
        this.popGitErrorNotificationToUser((meta as { step: GitStep }).step, message);
      }
      logger.log(level, this.translateMessage(message), meta);
    },
    error: (error) => {
      // this normally won't happen. And will become unhandled error. Because Observable error can't be catch, don't know why.
      reject(error as Error);
    },
    complete: () => {
      resolve();
    },
  });

  private createFailedDialog(message: string, wikiFolderPath: string): void {
    const mainWindow = this.windowService.get(WindowNames.main);
    if (mainWindow !== undefined) {
      void dialog
        .showMessageBox(mainWindow, {
          title: i18n.t('Log.SynchronizationFailed'),
          message,
          buttons: ['OK', 'Github Desktop'],
          cancelId: 0,
          defaultId: 1,
        })
        .then(async ({ response }) => {
          if (response === 1) {
            try {
              const result = await this.nativeService.openInGitGuiApp(wikiFolderPath);
              if (!result) {
                throw new Error('open github desktop download site');
              }
            } catch (error) {
              logger.error((error as Error).message);
              await shell.openExternal(githubDesktopUrl);
            }
          }
        })
        .catch((error) => logger.error('createFailedDialog failed', error));
    }
  }

  public async initWikiGit(wikiFolderPath: string, isSyncedWiki?: boolean, isMainWiki?: boolean, remoteUrl?: string, userInfo?: IGitUserInfos): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const syncImmediately = !!isSyncedWiki && !!isMainWiki;
    await new Promise<void>((resolve, reject) => {
      this.gitWorker
        ?.initWikiGit(wikiFolderPath, this.getErrorMessageI18NDict(), syncImmediately && net.isOnline(), remoteUrl, userInfo)
        .subscribe(this.getWorkerMessageObserver(wikiFolderPath, resolve, reject));
    });
  }

  public async commitAndSync(workspace: IWorkspace, config: ICommitAndSyncConfigs): Promise<boolean> {
    if (!net.isOnline()) {
      return false;
    }
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const observable = this.gitWorker?.commitAndSyncWiki(workspace, config, this.getErrorMessageI18NDict());
        observable?.subscribe(this.getWorkerMessageObserver(workspace.wikiFolderLocation, () => {}, reject));
        let hasChanges = false;
        observable?.subscribe({
          next: (messageObject) => {
            if (messageObject.level === 'error') {
              return;
            }
            const { meta } = messageObject;
            if (typeof meta === 'object' && meta !== null && 'step' in meta && stepWithChanges.includes((meta as { step: GitStep }).step)) {
              hasChanges = true;
            }
          },
          complete: () => {
            resolve(hasChanges);
          },
        });
        return true;
      });
    } catch (error) {
      this.createFailedDialog((error as Error).message, workspace.wikiFolderLocation);
      return true;
    }
  }

  public async clone(remoteUrl: string, repoFolderPath: string, userInfo: IGitUserInfos): Promise<void> {
    if (!net.isOnline()) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.gitWorker?.cloneWiki(repoFolderPath, remoteUrl, userInfo, this.getErrorMessageI18NDict()).subscribe(this.getWorkerMessageObserver(repoFolderPath, resolve, reject));
    });
  }
}
