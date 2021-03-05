/* eslint-disable unicorn/no-null */
import { injectable } from 'inversify';
import getDecorators from 'inversify-inject-decorators';
import settings from 'electron-settings';
import { IAuthingUserInfo as IAuthingUserInfo } from '@services/types';
import { container } from '@services/container';
import type { IWindowService } from '@services/windows/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import { AuthenticationChannel } from '@/constants/channels';
import { IAuthenticationService, IUserInfos } from './interface';
import { Subject } from 'rxjs';

const { lazyInject } = getDecorators(container);

const defaultUserInfos = {
  userName: 'TiddlyGit User',
  authing: undefined as IAuthingUserInfo | undefined,
};

@injectable()
export class Authentication implements IAuthenticationService {
  @lazyInject(serviceIdentifier.Window) private readonly windowService!: IWindowService;

  private cachedUserInfo: IUserInfos;
  private readonly version = '2021.1';
  public userInfo$: Subject<IUserInfos>;

  constructor() {
    this.cachedUserInfo = this.getInitUserInfoForCache();
    this.userInfo$ = new Subject<IUserInfos>();
    this.updateUserInfoSubject();
  }

  private updateUserInfoSubject(): void {
    this.userInfo$.next(this.cachedUserInfo);
  }

  /**
   * load UserInfos in sync, and ensure it is an Object
   */
  private getInitUserInfoForCache = (): IUserInfos => {
    let userInfosFromDisk = settings.getSync(`userInfo.${this.version}`) ?? {};
    userInfosFromDisk = typeof userInfosFromDisk === 'object' && !Array.isArray(userInfosFromDisk) ? userInfosFromDisk : {};
    return { ...defaultUserInfos, ...this.sanitizeUserInfo(userInfosFromDisk) };
  };

  private sanitizeUserInfo(info: Partial<IUserInfos>): Partial<IUserInfos> {
    return info;
  }

  /**
   * Batch update all UserInfos
   */
  private async setUserInfos(newUserInfos: IUserInfos): Promise<void> {
    await settings.set(`userInfos.${this.version}`, newUserInfos as any);
  }

  /**
   * get UserInfos, may return cached version
   */
  public getUserInfos = (): IUserInfos => {
    // store in memory to boost performance
    if (this.cachedUserInfo === undefined) {
      return this.getInitUserInfoForCache();
    }
    return this.cachedUserInfo;
  };

  public get<K extends keyof IUserInfos>(key: K): IUserInfos[K] | undefined {
    if (this.cachedUserInfo[key] !== null && this.cachedUserInfo[key] !== undefined) {
      return this.cachedUserInfo[key];
    }
  }

  public set<K extends keyof IUserInfos>(key: K, value: IUserInfos[K]): void {
    this.cachedUserInfo[key] = value;
    this.cachedUserInfo = { ...this.cachedUserInfo, ...this.sanitizeUserInfo(this.cachedUserInfo) };
    this.updateUserInfoSubject();
    void this.setUserInfos(this.cachedUserInfo)
  }

  public async reset(): Promise<void> {
    await settings.unset();
    this.cachedUserInfo = this.getInitUserInfoForCache();
    await this.setUserInfos(this.cachedUserInfo);
    this.updateUserInfoSubject();
  }
}
