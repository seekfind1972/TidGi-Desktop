/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { BrowserView, BrowserWindow, session, ipcMain, WebPreferences } from 'electron';
import { injectable } from 'inversify';

import serviceIdentifier from '@services/serviceIdentifier';
import type { IPreferenceService } from '@services/preferences/interface';
import type { IWorkspaceMetaData, IWorkspaceService } from '@services/workspaces/interface';
import type { IWorkspaceViewService } from '@services/workspacesView/interface';
import type { IWindowService } from '@services/windows/interface';
import type { IMenuService } from '@services/menu/interface';

import { WindowNames, IBrowserViewMetaData } from '@services/windows/WindowProperties';
import i18n from '@services/libs/i18n';
import getViewBounds from '@services/libs/getViewBounds';
import { IWorkspace } from '@services/workspaces/interface';
import setupViewEventHandlers from './setupViewEventHandlers';
import getFromRenderer from '@services/libs/getFromRenderer';
import { ViewChannel, MetaDataChannel, WindowChannel } from '@/constants/channels';
import { lazyInject } from '@services/container';
import { IViewService } from './interface';
import { getLocalHostUrlWithActualIP, replaceUrlPortWithSettingPort } from '@services/libs/url';
import { logger } from '@services/libs/log';
import { ViewLoadUrlError } from './error';

@injectable()
export class View implements IViewService {
  @lazyInject(serviceIdentifier.Preference) private readonly preferenceService!: IPreferenceService;
  @lazyInject(serviceIdentifier.Window) private readonly windowService!: IWindowService;
  @lazyInject(serviceIdentifier.Workspace) private readonly workspaceService!: IWorkspaceService;
  @lazyInject(serviceIdentifier.MenuService) private readonly menuService!: IMenuService;
  @lazyInject(serviceIdentifier.WorkspaceView) private readonly workspaceViewService!: IWorkspaceViewService;

  constructor() {
    this.initIPCHandlers();
    void this.registerMenu();
  }

  private initIPCHandlers(): void {
    // https://www.electronjs.org/docs/tutorial/online-offline-events
    ipcMain.handle(ViewChannel.onlineStatusChanged, async (_event, online: boolean) => {
      if (online) {
        await this.reloadViewsWebContentsIfDidFailLoad();
      }
    });
  }

  private async registerMenu(): Promise<void> {
    const hasWorkspaces = (await this.workspaceService.countWorkspaces()) > 0;
    const sidebar = await this.preferenceService.get('sidebar');
    const titleBar = await this.preferenceService.get('titleBar');
    await this.menuService.insertMenu('View', [
      {
        label: () => (sidebar ? i18n.t('Preference.HideSideBar') : i18n.t('Preference.ShowSideBar')),
        accelerator: 'CmdOrCtrl+Alt+S',
        click: async () => {
          const sidebarLatest = await this.preferenceService.get('sidebar');
          void this.preferenceService.set('sidebar', !sidebarLatest);
          void this.workspaceViewService.realignActiveWorkspace();
        },
      },
      {
        label: () => (titleBar ? i18n.t('Preference.HideTitleBar') : i18n.t('Preference.ShowTitleBar')),
        accelerator: 'CmdOrCtrl+Alt+T',
        enabled: process.platform === 'darwin',
        visible: process.platform === 'darwin',
        click: async () => {
          const titleBarLatest = await this.preferenceService.get('titleBar');
          void this.preferenceService.set('titleBar', !titleBarLatest);
          void this.workspaceViewService.realignActiveWorkspace();
        },
      },
      // same behavior as BrowserWindow with autoHideMenuBar: true
      // but with addition to readjust BrowserView so it won't cover the menu bar
      {
        label: () => i18n.t('Preference.ToggleMenuBar'),
        visible: false,
        accelerator: 'Alt+M',
        enabled: process.platform === 'win32',
        click: async (_menuItem, browserWindow) => {
          // if back is called in popup window
          // open menu bar in the popup window instead
          if (browserWindow === undefined) return;
          const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
          if (isPopup === true) {
            browserWindow.setMenuBarVisibility(!browserWindow.isMenuBarVisible());
            return;
          }
          const mainWindow = this.windowService.get(WindowNames.main);
          mainWindow?.setMenuBarVisibility(!mainWindow?.isMenuBarVisible());
          void this.workspaceViewService.realignActiveWorkspace();
        },
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      {
        label: () => i18n.t('Menu.ActualSize'),
        accelerator: 'CmdOrCtrl+0',
        click: async (_menuItem, browserWindow) => {
          // if item is called in popup window
          // open menu bar in the popup window instead
          if (browserWindow === undefined) return;
          const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
          if (isPopup === true) {
            const contents = browserWindow.webContents;
            contents.zoomFactor = 1;
            return;
          }
          const mainWindow = this.windowService.get(WindowNames.main);
          const webContent = mainWindow?.getBrowserView()?.webContents;
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (webContent) {
            webContent.setZoomFactor(1);
          }
        },
        enabled: hasWorkspaces,
      },
      {
        label: () => i18n.t('Menu.ZoomIn'),
        accelerator: 'CmdOrCtrl+=',
        click: async (_menuItem, browserWindow) => {
          // if item is called in popup window
          // open menu bar in the popup window instead
          if (browserWindow === undefined) return;
          const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
          if (isPopup === true) {
            const contents = browserWindow.webContents;
            contents.zoomFactor += 0.1;
            return;
          }
          const mainWindow = this.windowService.get(WindowNames.main);
          const webContent = mainWindow?.getBrowserView()?.webContents;
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (webContent) {
            webContent.setZoomFactor(webContent.getZoomFactor() + 0.1);
          }
        },
        enabled: hasWorkspaces,
      },
      {
        label: () => i18n.t('Menu.ZoomOut'),
        accelerator: 'CmdOrCtrl+-',
        click: async (_menuItem, browserWindow) => {
          // if item is called in popup window
          // open menu bar in the popup window instead
          if (browserWindow === undefined) return;
          const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
          if (isPopup === true) {
            const contents = browserWindow.webContents;
            contents.zoomFactor -= 0.1;
            return;
          }
          const mainWindow = this.windowService.get(WindowNames.main);
          const webContent = mainWindow?.getBrowserView()?.webContents;
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (webContent) {
            webContent.setZoomFactor(webContent.getZoomFactor() - 0.1);
          }
        },
        enabled: hasWorkspaces,
      },
      { type: 'separator' },
      {
        label: () => i18n.t('ContextMenu.Reload'),
        accelerator: 'CmdOrCtrl+R',
        click: async (_menuItem, browserWindow) => {
          // if item is called in popup window
          // open menu bar in the popup window instead
          if (browserWindow === undefined) return;
          const { isPopup } = await getFromRenderer<IBrowserViewMetaData>(MetaDataChannel.getViewMetaData, browserWindow);
          if (isPopup === true) {
            browserWindow.webContents.reload();
            return;
          }

          const mainWindow = this.windowService.get(WindowNames.main);
          const webContent = mainWindow?.getBrowserView()?.webContents;
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (webContent) {
            webContent.reload();
          }
        },
        enabled: hasWorkspaces,
      },
    ]);
  }

  /**
   * Record<workspaceID, Record<windowName, BrowserView>>
   *
   * Each workspace can have several windows to render its view (main window and menu bar)
   */
  private views: Record<string, Record<WindowNames, BrowserView> | undefined> = {};
  public getView = (workspaceID: string, windowName: WindowNames): BrowserView | undefined => this.views[workspaceID]?.[windowName];
  public getAllViewOfWorkspace = (workspaceID: string): BrowserView[] => Object.values(this.views[workspaceID] ?? {});
  public setView = (workspaceID: string, windowName: WindowNames, newView: BrowserView): void => {
    const workspaceOwnedViews = this.views[workspaceID];
    if (workspaceOwnedViews === undefined) {
      this.views[workspaceID] = { [windowName]: newView } as Record<WindowNames, BrowserView>;
    } else {
      workspaceOwnedViews[windowName] = newView;
    }
  };

  private shouldMuteAudio = false;
  private shouldPauseNotifications = false;

  public async addViewForAllBrowserViews(workspace: IWorkspace): Promise<void> {
    await Promise.all([
      this.addView(workspace, WindowNames.main),
      this.preferenceService.get('attachToMenubar').then((attachToMenubar) => {
        attachToMenubar && this.addView(workspace, WindowNames.menuBar);
      }),
    ]);
  }

  public async addView(workspace: IWorkspace, windowName: WindowNames): Promise<void> {
    // we assume each window will only have one view, so get view by window name + workspace
    const existedView = this.getView(workspace.id, windowName);
    const browserWindow = this.windowService.get(windowName);
    if (existedView !== undefined || browserWindow === undefined) {
      return;
    }
    // create a new BrowserView
    const { rememberLastPageVisited, shareWorkspaceBrowsingData, spellcheck, spellcheckLanguages } = await this.preferenceService.getPreferences();
    // configure session, proxy & ad blocker
    const partitionId = shareWorkspaceBrowsingData ? 'persist:shared' : `persist:${workspace.id}`;
    // prepare configs for start a BrowserView that loads wiki's web content
    // session
    const sessionOfView = session.fromPartition(partitionId);
    // spellchecker
    if (spellcheck && process.platform !== 'darwin') {
      sessionOfView.setSpellCheckerLanguages(spellcheckLanguages);
    }
    const browserViewMetaData: IBrowserViewMetaData = { workspaceID: workspace.id };
    const sharedWebPreferences: WebPreferences = {
      devTools: true,
      spellcheck,
      nativeWindowOpen: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      session: sessionOfView,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      additionalArguments: [
        `${MetaDataChannel.browserViewMetaData}${WindowNames.view}`,
        `${MetaDataChannel.browserViewMetaData}${encodeURIComponent(JSON.stringify(browserViewMetaData))}`,
      ],
    };
    const view = new BrowserView({
      webPreferences: sharedWebPreferences,
    });
    // background needs to explicitly set
    // if not, by default, the background of BrowserView is transparent
    // which would break the CSS of certain websites
    // even with dark mode, all major browsers
    // always use #FFF as default page background
    // https://github.com/atomery/webcatalog/issues/723
    // https://github.com/electron/electron/issues/16212
    view.setBackgroundColor('#fafafa');

    // Handle audio & notification preferences
    if (this.shouldMuteAudio !== undefined) {
      view.webContents.audioMuted = this.shouldMuteAudio;
    }
    this.setView(workspace.id, windowName, view);
    if (workspace.active) {
      browserWindow.setBrowserView(view);
      const contentSize = browserWindow.getContentSize();
      view.setBounds(await getViewBounds(contentSize as [number, number]));
      view.setAutoResize({
        width: true,
        height: true,
      });
    }
    const initialUrl = getLocalHostUrlWithActualIP(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      replaceUrlPortWithSettingPort((rememberLastPageVisited && workspace.lastUrl) || workspace.homeUrl, workspace.port),
    );
    /**
     * Try catch loadUrl, other wise it will throw unhandled promise rejection Error: ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:5212/
     * We will set `didFailLoadErrorMessage`, and `didFailLoadTimes < LOAD_VIEW_MAX_RETRIES` in `setupViewEventHandlers`, it will set didFailLoadErrorMessage, and we throw actuarial error after that
     */
    const loadInitialUrlWithCatch = async (): Promise<void> => {
      try {
        await view.webContents.loadURL(initialUrl);
        const unregisterContextMenu = await this.menuService.initContextMenuForWindowWebContents(view.webContents);
        view.webContents.on('destroyed', () => {
          unregisterContextMenu();
        });
      } catch (error) {
        let didFailLoadTimes = 0;
        try {
          const workspaceMetaData = await this.workspaceService.getMetaData(workspace.id);
          didFailLoadTimes = workspaceMetaData.didFailLoadTimes ?? 0;
        } catch {}
        logger.error(new ViewLoadUrlError(initialUrl, didFailLoadTimes, `${(error as Error).message} ${(error as Error).stack ?? ''}`));
      }
    };
    setupViewEventHandlers(view, browserWindow, {
      shouldPauseNotifications: this.shouldPauseNotifications,
      workspace,
      sharedWebPreferences,
      loadInitialUrlWithCatch,
    });
    await loadInitialUrlWithCatch();
  }

  public forEachView(functionToRun: (view: BrowserView, workspaceID: string, windowName: WindowNames) => unknown): void {
    Object.keys(this.views).forEach((id) => {
      const workspaceOwnedViews = this.views[id];
      if (workspaceOwnedViews !== undefined) {
        (Object.keys(workspaceOwnedViews) as WindowNames[]).forEach((name) => {
          const view = this.getView(id, name);
          if (view !== undefined) {
            functionToRun(view, id, name);
          }
        });
      }
    });
  }

  public async setActiveViewForAllBrowserViews(workspaceID: string): Promise<void> {
    await Promise.all([
      this.setActiveView(workspaceID, WindowNames.main),
      this.preferenceService.get('attachToMenubar').then((attachToMenubar) => {
        attachToMenubar && this.setActiveView(workspaceID, WindowNames.menuBar);
      }),
    ]);
  }

  public async setActiveView(workspaceID: string, windowName: WindowNames): Promise<void> {
    const browserWindow = this.windowService.get(windowName);
    if (browserWindow === undefined) {
      return;
    }
    // stop find in page when switching workspaces
    const currentView = browserWindow.getBrowserView();
    if (currentView !== null) {
      currentView.webContents.stopFindInPage('clearSelection');
      currentView.webContents.send(WindowChannel.closeFindInPage);
    }
    const workspace = await this.workspaceService.get(workspaceID);
    const view = this.getView(workspaceID, windowName);
    if (view === undefined) {
      if (workspace !== undefined) {
        return await this.addView(workspace, windowName);
      } else {
        logger.error(`workspace is undefined when setActiveView(${windowName}, ${workspaceID})`);
      }
    } else {
      browserWindow.setBrowserView(view);
      const contentSize = browserWindow.getContentSize();
      if (typeof (await this.workspaceService.getMetaData(workspaceID)).didFailLoadErrorMessage !== 'string') {
        view.setBounds(await getViewBounds(contentSize as [number, number], false, 0, 0)); // hide browserView to show error message
      } else {
        view.setBounds(await getViewBounds(contentSize as [number, number]));
      }
      view.setAutoResize({
        width: true,
        height: true,
      });
      // focus on webview
      // https://github.com/quanglam2807/webcatalog/issues/398
      view.webContents.focus();
      browserWindow.setTitle(view.webContents.getTitle());
    }
  }

  public removeView = (workspaceID: string, windowName: WindowNames): void => {
    const view = this.getView(workspaceID, windowName);
    void session.fromPartition(`persist:${workspaceID}`).clearStorageData();
    if (view !== undefined) {
      // currently use workaround https://github.com/electron/electron/issues/10096
      // @ts-expect-error Property 'destroy' does not exist on type 'WebContents'.ts(2339)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      view.webContents.destroy();
    }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.views[workspaceID]![windowName];
  };

  public removeAllViewOfWorkspace = (workspaceID: string): void => {};

  public setViewsAudioPref = (_shouldMuteAudio?: boolean): void => {
    if (_shouldMuteAudio !== undefined) {
      this.shouldMuteAudio = _shouldMuteAudio;
    }

    this.forEachView(async (view, id, name) => {
      const workspace = await this.workspaceService.get(id);
      if (view !== undefined && workspace !== undefined) {
        view.webContents.audioMuted = workspace.disableAudio || this.shouldMuteAudio;
      }
    });
  };

  public setViewsNotificationsPref = (_shouldPauseNotifications?: boolean): void => {
    if (_shouldPauseNotifications !== undefined) {
      this.shouldPauseNotifications = _shouldPauseNotifications;
    }
  };

  public async reloadViewsWebContentsIfDidFailLoad(): Promise<void> {
    const workspaceMetaData: Record<string, Partial<IWorkspaceMetaData>> = await this.workspaceService.getAllMetaData();
    this.forEachView((view, id, name) => {
      if (typeof workspaceMetaData[id].didFailLoadErrorMessage !== 'string') {
        return;
      }
      view.webContents.reload();
    });
  }

  public async reloadViewsWebContents(workspaceID?: string): Promise<void> {
    this.forEachView((view, id, name) => {
      if (workspaceID !== undefined && id !== workspaceID) {
        return;
      }
      view.webContents.reload();
    });
  }

  public async getActiveBrowserView(): Promise<BrowserView | undefined> {
    const workspace = await this.workspaceService.getActiveWorkspace();
    if (workspace !== undefined) {
      return this.getView(workspace.id, WindowNames.main);
    }
  }

  public async reloadActiveBrowserView(): Promise<void> {
    const view = await this.getActiveBrowserView();
    if (view !== undefined) {
      view.webContents.reload();
    }
  }

  public realignActiveView = async (browserWindow: BrowserWindow, activeId: string, isRetry?: boolean): Promise<void> => {
    const view = browserWindow.getBrowserView();
    if (view?.webContents !== null && view?.webContents !== undefined) {
      const contentSize = browserWindow.getContentSize();
      const didFailLoadErrorMessage = (await this.workspaceService.getMetaData(activeId)).didFailLoadErrorMessage;
      if (typeof didFailLoadErrorMessage === 'string' && didFailLoadErrorMessage.length > 0) {
        view?.setBounds(await getViewBounds(contentSize as [number, number], false, 0, 0)); // hide browserView to show error message
      } else {
        view?.setBounds(await getViewBounds(contentSize as [number, number]));
      }
    } else if (isRetry !== true) {
      // retry one time later if webContent is not ready yet
      setTimeout(() => void this.realignActiveView(browserWindow, activeId, true), 1000);
    }
  };
}
