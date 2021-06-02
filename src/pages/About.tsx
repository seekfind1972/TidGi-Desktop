import React from 'react';
import styled from 'styled-components';
import { Trans, useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';

import { Button, DialogContent as DialogContentRaw } from '@material-ui/core';
import { usePromiseValue } from '@/helpers/useServiceValue';
import iconPath from '../../build-resources/icon.png';

const DialogContent = styled(DialogContentRaw)`
  min-width: 320px;
  text-align: 'center';
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

const Icon = styled.img`
  height: 96px;
  width: 96px;
`;

const Title = styled.h6`
  margin-top: 10px;
`;

const TiddlyGitVersion = styled.p`
  margin-top: 0;
  margin-bottom: 20px;
  text-align: center;
`;

const DependenciesVersionsContainer = styled.div`
  margin-top: 0px;
  margin-bottom: 20px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

const DependenciesVersions = styled.div`
  font-size: 0.8rem;
  text-align: center;
`;

const ButtonContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
`;
const GoToTheWebsiteButton = styled(Button)`
  margin-right: 10px;
`;

const MadeBy = styled.div`
  margin-top: 20px;
`;

const Link = styled.span`
  font-weight: 600;
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`;

export default function About(): JSX.Element {
  const { t } = useTranslation();
  const versions = usePromiseValue(async () => {
    const processVersions = await window.service.context.get('environmentVersions');
    return [
      { name: 'Electron Version', version: processVersions.electron },
      { name: 'Node Version', version: processVersions.node },
      { name: 'Chromium Version', version: processVersions.chrome },
    ];
  }, [] as Array<{ name: string; version: string }>);

  const appVersion = usePromiseValue<string>(async () => await window.service.context.get('appVersion'));
  const platform = usePromiseValue<string>(async () => await window.service.context.get('platform'));

  return (
    <DialogContent>
      <Helmet>
        <title>{t('ContextMenu.About')}</title>
      </Helmet>
      <Icon src={iconPath} alt="TiddlyGit" />
      <Title>TiddlyGit ({platform ?? 'Unknown Platform'})</Title>
      <TiddlyGitVersion>{`Version v${appVersion ?? ' - '}.`}</TiddlyGitVersion>
      <DependenciesVersionsContainer>
        {versions?.map(({ name, version }) => (
          <DependenciesVersions key={name}>
            {name}: {version}
          </DependenciesVersions>
        ))}
      </DependenciesVersionsContainer>

      <ButtonContainer>
        <GoToTheWebsiteButton onClick={async () => await window.service.native.open('https://github.com/tiddly-gittly/TiddlyGit-Desktop')}>
          Website
        </GoToTheWebsiteButton>
        <GoToTheWebsiteButton onClick={async () => await window.service.native.open('https://github.com/tiddly-gittly/TiddlyGit-Desktop/issues/new/choose')}>
          Support
        </GoToTheWebsiteButton>
      </ButtonContainer>

      <MadeBy>
        <Trans t={t} i18nKey="Dialog.MadeWithLove">
          <span>Made with </span>
          <span role="img" aria-label="love">
            ❤
          </span>
          <span> by </span>
        </Trans>
        <Link
          onClick={async () => await window.service.native.open('https://onetwo.ren/wiki/')}
          onKeyDown={async (event) => {
            if (event.key !== 'Enter') {
              return;
            }
            await window.service.native.open('https://onetwo.ren/wiki/');
          }}
          role="link"
          tabIndex={0}>
          {t('LinOnetwo')}
        </Link>
        <span> && </span>
        <Link
          onClick={async () => await window.service.native.open('https://webcatalog.app/?utm_source=tiddlygit_app')}
          onKeyDown={async (event) => {
            if (event.key !== 'Enter') {
              return;
            }
            await window.service.native.open('https://webcatalog.app/?utm_source=tiddlygit_app');
          }}
          role="link"
          tabIndex={0}>
          {t('Preference.WebCatalog')}
        </Link>
      </MadeBy>
    </DialogContent>
  );
}